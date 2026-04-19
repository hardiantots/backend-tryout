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
    const llmNarrative = await this.generateWithLlm(summary, fallbackInsight.strongest, fallbackInsight.weakest, fallbackInsight.nameMap);
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
    nameMap: Map<string, string>;
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

    const weakMaterialLines = weakMaterials.length
      ? weakMaterials
          .map(
            (item: { materialTopic: string; subTestName: string; wrong: number; answered: number }) =>
              `- **${item.materialTopic}** (${item.subTestName}) — ${item.wrong} dari ${item.answered} jawaban salah`,
          )
          .join('\n')
      : '- Belum ada data materi yang cukup untuk dianalisis secara spesifik.';

    const strongestLine = strongest.length
      ? strongest.map((s) => `- ${s}`).join('\n')
      : '- Belum ada sub-tes dominan karena data jawaban masih minim.';

    const weakestLine = weakest.length
      ? weakest.map((w) => `- ${w}`).join('\n')
      : '- Semua sub-tes sudah cukup seimbang.';

    const narrative = [
      '## Ringkasan Performa',
      'Analisis hasil try out SNBT kamu telah selesai. Berikut adalah gambaran umum pencapaianmu saat ini.',
      '',
      '## Kelebihan',
      strongestLine,
      '',
      '## Area yang Perlu Ditingkatkan',
      weakestLine,
      '',
      '## Materi Prioritas yang Masih Lemah',
      weakMaterialLines,
      '',
      '## Saran Belajar 7 Hari ke Depan',
      '- Fokus pada 2 sub-tes dengan akurasi terendah selama 7 hari ke depan.',
      '- Kerjakan minimal 20 soal latihan per hari untuk materi prioritas yang masih lemah.',
      '- Evaluasi ulang progres dengan try out berikutnya setelah periode belajar selesai.',
      '',
      '## Motivasi Penutup',
      'Setiap soal yang kamu kerjakan adalah investasi untuk hasil yang lebih baik. Tetap konsisten, dan hasil nyata akan mengikuti.',
    ].join('\n');

    return { strongest, weakest, weakMaterials, narrative, nameMap };
  }

  private async generateWithLlm(summary: any, strongest: string[], weakest: string[], nameMap: Map<string, string>): Promise<string | null> {
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

    const userPrompt = this.buildPrompt(summary, strongest, weakest, nameMap);

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
          temperature: 0.65,
          max_tokens: 900,
          top_p: 0.92,
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

  private buildPrompt(summary: any, strongest: string[], weakest: string[], nameMap: Map<string, string>): string {
    const bySubTest = summary?.bySubTest ?? {};
    const subTestLines = Object.entries(bySubTest)
      .map(([code, val]: [string, any]) => {
        const name = nameMap.get(code) ?? code;
        const correct = Number(val?.correct ?? 0);
        const wrong = Number(val?.wrong ?? 0);
        const total = Number(val?.total ?? 0);
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
        return `- ${name} (${code}): Benar ${correct}, Salah ${wrong}, Total ${total}, Akurasi ${accuracy}%`;
      })
      .join('\n');

    const totals = summary?.totals ?? {};
    const weakMaterials = Array.isArray(summary?.weakMaterials)
      ? summary.weakMaterials
          .slice(0, 6)
          .map(
            (item: any) =>
              `- ${item.subTestName ?? item.subTestCode} — ${item.materialTopic}: ${item.wrong} salah dari ${item.answered} dijawab`,
          )
          .join('\n')
      : '(belum tersedia)';

    return [
      '## Data Hasil Try Out SNBT Peserta',
      `Total: Benar ${totals.correct ?? 0}, Salah ${totals.wrong ?? 0}, Dijawab ${totals.answered ?? 0}`,
      '',
      '### Skor Per Sub-Tes:',
      subTestLines,
      '',
      `### Sub-tes dengan performa terbaik: ${strongest.join(', ') || 'belum ada'}`,
      `### Sub-tes dengan performa terlemah: ${weakest.join(', ') || 'belum ada'}`,
      '',
      '### Materi yang paling banyak salah:',
      weakMaterials,
      '',
      '---',
      'Kamu adalah mentor SNBT berpengalaman. Berdasarkan data di atas, buatlah analisis mendalam dengan format Markdown berikut (WAJIB gunakan heading ##, bold **, dan bullet -).',
      '',
      'INSTRUKSI FORMAT (ikuti persis):',
      '## Ringkasan Performa',
      '(2-3 kalimat evaluasi objektif berdasarkan data: skor keseluruhan, akurasi rata-rata, apakah sudah cukup baik atau masih perlu banyak perbaikan)',
      '',
      '## Kelebihan',
      '(2-3 poin bullet berisi sub-tes atau kemampuan yang sudah baik beserta alasan spesifik berdasarkan data)',
      '',
      '## Area yang Perlu Ditingkatkan',
      '(2-3 poin bullet berisi sub-tes terlemah beserta penjelasan mengapa perlu fokus dan dampaknya pada total skor)',
      '',
      '## Materi Prioritas yang Masih Lemah',
      '(3-5 poin bullet berisi nama materi spesifik, sub-tes terkait, jumlah salah, dan saran singkat cara memperbaikinya)',
      '',
      '## Saran Belajar 7 Hari ke Depan',
      '(3-4 poin bullet berisi rencana belajar konkret dan actionable: waktu, materi, metode latihan)',
      '',
      '## Motivasi Penutup',
      '(1-2 kalimat motivasi yang konkret, bukan klise, berbasis pencapaian yang sudah ditunjukkan data)',
      '',
      'ATURAN PENTING:',
      '- Gunakan kata "kamu", bukan "Anda".',
      '- Setiap heading harus diawali dengan ## (dua tanda pagar).',
      '- Setiap poin harus diawali dengan - (tanda hubung dan spasi).',
      '- Pisahkan setiap section dengan baris kosong.',
      '- Jangan tambahkan penjelasan di luar format di atas.',
      '- Tulis dalam bahasa Indonesia yang natural dan memotivasi.',
    ].join('\n');
  }

  private normalizeNarrative(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove raw URL links but keep label text
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
      // Remove pipe chars (table artifacts)
      .replace(/\|/g, ' ')
      // Remove horizontal rules that aren't section breaks we want
      .replace(/^---+$/gm, '')
      // Remove emoji
      .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '')
      // Normalize escaped markdown chars
      .replace(/\\([*_`#\-])/g, '$1')
      // Ensure ## headings always have a blank line before them (except at start)
      .replace(/\n(#{1,6} )/g, '\n\n$1')
      // Ensure blank line after each heading
      .replace(/(#{1,6} [^\n]+)/g, '$1\n')
      // Collapse more than 2 consecutive blank lines
      .replace(/\n{3,}/g, '\n\n')
      // Remove trailing spaces per line
      .replace(/[ \t]+$/gm, '')
      .trim();
  }
}
