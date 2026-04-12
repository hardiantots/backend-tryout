-- AlterTable: Add orderIndex column to Question
ALTER TABLE "Question" ADD COLUMN "orderIndex" INTEGER NOT NULL DEFAULT 0;

-- Backfill orderIndex based on createdAt (oldest = 1, per subTest)
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "subTestId" ORDER BY "createdAt" ASC) AS rn
  FROM "Question"
)
UPDATE "Question" SET "orderIndex" = ranked.rn
FROM ranked
WHERE "Question"."id" = ranked."id";

-- CreateIndex
CREATE INDEX "Question_subTestId_orderIndex_idx" ON "Question"("subTestId", "orderIndex");
