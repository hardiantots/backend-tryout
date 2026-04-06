import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateInsight(examSessionId: string, requesterUserId: string) {
    const session = await this.prisma.examSession.findUnique({
      where: { id: examSessionId },
      select: {
        id: true,
        userId: true,
        scoreSummaryJson: true,
      },
    });

    if (!session) {
      throw new NotFoundException(`Session ${examSessionId} not found.`);
    }

    if (session.userId !== requesterUserId) {
      throw new ForbiddenException('You do not have access to this exam session.');
    }

    const summary = (session.scoreSummaryJson as any) ?? { bySubTest: {}, totals: { correct: 0, wrong: 0, answered: 0 } };

    const fallbackInsight = await this.buildFallbackInsight(summary);
    const llmNarrative = await this.generateWithLlm(summary, fallbackInsight.strongest, fallbackInsight.weakest);
    const narrative = this.normalizeNarrative(llmNarrative ?? fallbackInsight.narrative);

    return {
      success: true,
      examSessionId,
      prompt: 'Analisis skor 9 sub-tes SNBT ini dan berikan saran belajar yang memotivasi',
      insight: {
        strongest: fallbackInsight.strongest,
        weakest: fallbackInsight.weakest,
        weakMaterials: fallbackInsight.weakMaterials,
        narrative,
      },
      scoreSummary: summary,
      source: llmNarrative ? 'llm' : 'fallback',
    };
  }

  private async buildFallbackInsight(summary: any): Promise<{
    strongest: string[];
    weakest: string[];
    weakMaterials: Array<{ subTestCode: string; subTestName: string; materialTopic: string; wrong: number; answered: number }>;
    narrative: string;
  }> {
    const bySubTest = summary.bySubTest ?? {};
    const subTests = await this.prisma.subTest.findMany({
      select: { code: true, name: true },
    });
    const nameMap = new Map(subTests.map((item) => [item.code, item.name]));

    const ranked = Object.entries(bySubTest)
      .map(([code, value]: [string, any]) => {
        const answered = Number(value?.answered ?? 0);
        const correct = Number(value?.correct ?? 0);
        const accuracy = answered > 0 ? correct / answered : 0;
        return { code, name: nameMap.get(code) ?? code, accuracy };
      })
      .sort((a, b) => b.accuracy - a.accuracy);

    const strongest = ranked.slice(0, 2).map((x) => x.name);
    const weakest = ranked.slice(-2).map((x) => x.name);
    const weakMaterials = Array.isArray(summary?.weakMaterials)
      ? summary.weakMaterials
          .filter((item: any) => item && item.materialTopic && item.wrong > 0)
          .slice(0, 5)
          .map((item: any) => ({
            subTestCode: String(item.subTestCode ?? '-'),
            subTestName: String(item.subTestName ?? item.subTestCode ?? '-'),
            materialTopic: String(item.materialTopic),
            wrong: Number(item.wrong ?? 0),
            answered: Number(item.answered ?? 0),
          }))
      : [];

    const weakMaterialLine = weakMaterials.length
      ? `Materi prioritas yang perlu kamu perbaiki: ${weakMaterials
          .map((item: { materialTopic: string; subTestName: string }) => `${item.materialTopic} (${item.subTestName})`)
          .join(', ')}.`
      : 'Belum ada data materi yang cukup untuk dianalisis secara spesifik.';

    const narrative = [
      'Analisis SNBT kamu menunjukkan progres yang bagus. Pertahankan ritme belajar yang konsisten.',
      strongest.length ? `Kekuatan utama: ${strongest.join(', ')}.` : 'Belum ada sub-tes dominan karena data jawaban masih minim.',
      weakest.length ? `Perlu ditingkatkan: ${weakest.join(', ')}.` : 'Semua sub-tes sudah cukup seimbang.',
      weakMaterialLine,
      'Saran belajar: prioritaskan 2 sub-tes terlemah selama 7 hari ke depan, lalu evaluasi ulang dengan try out berikutnya.',
    ].join(' ');

    return { strongest, weakest, weakMaterials, narrative };
  }

  private async generateWithLlm(summary: any, strongest: string[], weakest: string[]): Promise<string | null> {
    const apiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
    const model = process.env.LLM_MODEL || process.env.AI_MODEL || 'google/gemini-2.5-flash-lite';

    if (!apiKey) {
      return null;
    }

    const baseUrl = process.env.LLM_BASE_URL || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    const endpoint = process.env.LLM_CHAT_ENDPOINT || process.env.OPENROUTER_CHAT_ENDPOINT || '/chat/completions';
    const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 15000);
    const appUrl = process.env.LLM_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const appTitle = process.env.LLM_APP_TITLE || 'Try Out SNBT 2026';
    const url = `${baseUrl.replace(/\/$/, '')}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const userPrompt = this.buildPrompt(summary, strongest, weakest);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };

      // OpenRouter attribution headers help provider routing and account diagnostics.
      headers['HTTP-Referer'] = appUrl;
      headers['X-Title'] = appTitle;

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.7,
          max_tokens: 500,
          top_p: 0.9,
          messages: [
            {
              role: 'system',
              content:
                'Kamu adalah mentor SNBT yang empatik dan tegas. Beri analisis berbasis data yang tersedia, hindari halusinasi, gunakan bahasa Indonesia natural, actionable, dan memotivasi.',
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const reason = this.mapLlmStatusReason(response.status);
        const providerMessage = this.extractProviderMessage(errorText);

        this.logger.warn(
          `LLM request failed (${response.status} - ${reason}): ${providerMessage.slice(0, 240)}`,
        );

        // Keep API resilient by falling back when provider is unavailable/rejected.
        return null;
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = payload?.choices?.[0]?.message?.content?.trim();
      return content || null;
    } catch (error) {
      const message = (error as Error).message;
      if (message.toLowerCase().includes('aborted')) {
        this.logger.warn(`LLM request timeout after ${timeoutMs}ms.`);
      } else {
        this.logger.warn(`LLM request error: ${message}`);
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private mapLlmStatusReason(status: number): string {
    if (status === 401) return 'invalid api key';
    if (status === 402) return 'insufficient credits';
    if (status === 404) return 'model unavailable or blocked by provider policy';
    if (status === 429) return 'rate limited';
    if (status >= 500) return 'provider internal error';
    return 'request rejected';
  }

  private extractProviderMessage(rawBody: string): string {
    if (!rawBody) return 'Empty provider response body.';

    try {
      const parsed = JSON.parse(rawBody) as { error?: { message?: string } | string; message?: string };

      if (typeof parsed.error === 'string') {
        return parsed.error;
      }

      if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) {
        return parsed.error.message;
      }

      if (parsed.message) {
        return parsed.message;
      }
    } catch {
      // Fallback to raw text when provider returns non-JSON payload.
    }

    return rawBody;
  }

  private buildPrompt(summary: any, strongest: string[], weakest: string[]): string {
    const weakMaterials = Array.isArray(summary?.weakMaterials)
      ? summary.weakMaterials
          .slice(0, 5)
          .map((item: any) => `${item.subTestName ?? item.subTestCode}: ${item.materialTopic}`)
          .join('; ')
      : 'belum tersedia';

    return [
      'Berikut data hasil try out SNBT:',
      JSON.stringify(summary),
      `Sub-tes terkuat sementara: ${strongest.join(', ') || 'belum ada'}.`,
      `Sub-tes terlemah sementara: ${weakest.join(', ') || 'belum ada'}.`,
      `Materi dengan performa terlemah: ${weakMaterials}.`,
      'PENTING: Berikan jawaban plain text saja (tanpa markdown, tanpa simbol dekoratif, tanpa emoji).',
      'Berikan output maksimal 220 kata dengan format:',
      '- Evaluasi singkat performa berdasarkan data.',
      '- Prioritas belajar 7 hari dalam 3 poin (awali tiap poin dengan simbol "•").',
      '- Sebutkan materi prioritas yang masih lemah (maksimal 3 materi) dan alasan singkatnya.',
      '- Motivasi penutup yang konkret dan realistis.',
      'Gunakan kata "kamu", bukan "Anda".',
    ].join('\n');
  }

  private normalizeNarrative(text: string): string {
    return text
      .replace(/\r/g, '')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
      .replace(/\|/g, ' ')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^---+$/gm, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\\([*_`#\-])/g, '$1')
      .replace(/^[-*]\s+/gm, '• ')
      .replace(/^\d+[.)]\s+/gm, '• ')
      .replace(/^[^\p{L}\p{N}(•\-)]*/gmu, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
