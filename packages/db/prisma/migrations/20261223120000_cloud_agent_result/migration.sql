-- A finished agent's final message, kept so a helper can judge the result without reading the thread.
ALTER TABLE "cloud_agents" ADD COLUMN "resultText" TEXT;
