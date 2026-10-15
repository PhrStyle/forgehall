-- Choices an agent offers with a question to the user, shown as buttons in the console.
ALTER TABLE messages ADD COLUMN options jsonb;
