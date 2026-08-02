ALTER TABLE "agents" ADD COLUMN "prompt_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL;
