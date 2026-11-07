-- Data-only roll-forward. Original asset files, legacy references, immutable
-- version snapshots, and print-job snapshots remain available for audit/revert.
DO $$
DECLARE tenant uuid;
BEGIN
  FOR tenant IN SELECT id FROM businesses LOOP
    PERFORM set_config('app.business_id', tenant::text, true);
    UPDATE products SET data = data || jsonb_build_object(
      'graphicAssetId', COALESCE(NULLIF(data->>'graphicAssetId',''), NULLIF(data->>'iconAssetId',''), ''),
      'labelArtworkVersion', 2
    ), updated_at = NOW()
    WHERE business_id = tenant AND COALESCE(data->>'labelArtworkVersion','') <> '2';
    UPDATE label_templates t SET data = jsonb_set(t.data, '{elements}', (
      SELECT jsonb_agg(CASE WHEN e->>'binding' = 'product.icon'
        THEN jsonb_set(e, '{binding}', '"product.graphic"'::jsonb) ELSE e END ORDER BY position)
      FROM jsonb_array_elements(t.data->'elements') WITH ORDINALITY AS elements(e, position)
    )), updated_at = NOW()
    WHERE business_id = tenant AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.data->'elements')='array' THEN t.data->'elements' ELSE '[]'::jsonb END) e WHERE e->>'binding'='product.icon'
    );
    UPDATE label_elements SET data=jsonb_set(data,'{binding}','"product.graphic"'::jsonb),updated_at=NOW()
    WHERE business_id=tenant AND data->>'binding'='product.icon';
  END LOOP;
END $$;
