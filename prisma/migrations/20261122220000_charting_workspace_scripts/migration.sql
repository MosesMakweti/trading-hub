-- Charting workspace, Traditorium Script library, simulation chart drawings. Additive only.

-- CreateTable
CREATE TABLE "ChartWorkspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChartWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserScript" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'indicator',
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserScript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserScriptVersion" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserScriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimChartDrawing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "anchors" JSONB NOT NULL,
    "style" JSONB NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimChartDrawing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChartWorkspace_userId_key_key" ON "ChartWorkspace"("userId", "key");

-- CreateIndex
CREATE INDEX "UserScript_userId_archivedAt_idx" ON "UserScript"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserScriptVersion_scriptId_version_key" ON "UserScriptVersion"("scriptId", "version");

-- CreateIndex
CREATE INDEX "SimChartDrawing_accountId_assetSymbol_idx" ON "SimChartDrawing"("accountId", "assetSymbol");


-- AddForeignKey
ALTER TABLE "ChartWorkspace" ADD CONSTRAINT "ChartWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScript" ADD CONSTRAINT "UserScript_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScriptVersion" ADD CONSTRAINT "UserScriptVersion_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "UserScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimChartDrawing" ADD CONSTRAINT "SimChartDrawing_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SimAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A drawing and its simulation account must belong to the same user.
CREATE TRIGGER "SimChartDrawing_owner" BEFORE INSERT OR UPDATE OF "userId", "accountId" ON "SimChartDrawing" FOR EACH ROW EXECUTE FUNCTION sim_child_owner_guard();
