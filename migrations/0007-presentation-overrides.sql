ALTER TABLE businesses ADD COLUMN palette_override TEXT;
ALTER TABLE businesses ADD COLUMN layout_override TEXT CHECK (layout_override IN ('centered', 'split', 'minimal'));
ALTER TABLE businesses ADD COLUMN style_override TEXT CHECK (style_override IN ('modern', 'elegant', 'bold'));
