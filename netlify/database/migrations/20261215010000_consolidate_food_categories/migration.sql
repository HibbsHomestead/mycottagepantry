-- Data-only migration. Every lookup and update stays inside one business.
-- No stock, pricing, historical transactions or financial categories are touched.
CREATE FUNCTION pg_temp.pantry_category_name(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE lower(btrim(value))
 WHEN 'breads' THEN 'Breads & Rolls' WHEN 'breads & rolls' THEN 'Breads & Rolls'
 WHEN 'cakes' THEN 'Cakes & Cupcakes' WHEN 'cakes & cupcakes' THEN 'Cakes & Cupcakes'
 WHEN 'fillings' THEN 'Preps, Fillings & Toppings'
 WHEN 'preps & fillings' THEN 'Preps, Fillings & Toppings'
 WHEN 'preps, fillings & toppings' THEN 'Preps, Fillings & Toppings'
 ELSE btrim(value) END
$$;
DO $$
DECLARE
 business record; config record; field text; table_name text; reference text;
 revision text; categories jsonb; merged jsonb; redirects jsonb; c jsonb;
 destination jsonb; aliases jsonb; r record; next_data jsonb; target jsonb;
 counts jsonb; count_key text; settings_data jsonb; implicit record;
BEGIN
 FOR business IN SELECT id FROM businesses LOOP
  PERFORM set_config('app.business_id',business.id::text,true);
  FOR config IN SELECT id,data FROM settings WHERE business_id=business.id FOR UPDATE LOOP
   settings_data := config.data;
   counts := coalesce(settings_data->'categoryConsolidationCounts','{}'::jsonb);
   FOREACH field IN ARRAY ARRAY['recipeCategories','productCategories','pantryCategories'] LOOP
    table_name := CASE field WHEN 'recipeCategories' THEN 'recipes' WHEN 'pantryCategories' THEN 'ingredients' ELSE 'products' END;
    reference := CASE field WHEN 'recipeCategories' THEN 'recipeCategoryId' WHEN 'pantryCategories' THEN 'sectionCategoryId' ELSE 'productCategoryId' END;
    revision := CASE field WHEN 'recipeCategories' THEN 'recipeCategoryRevision' WHEN 'pantryCategories' THEN 'pantryCategoryRevision' ELSE 'categoryConfigRevision' END;
    categories := coalesce(settings_data->field,'[]'::jsonb);
    IF field='recipeCategories' THEN
     FOR implicit IN SELECT * FROM (VALUES
      ('recipe-breads','Breads','bread'),
      ('recipe-breads%20%26%20rolls','Breads & Rolls','bread'),
      ('recipe-cakes','Cakes','cake'),
      ('recipe-cakes%20%26%20cupcakes','Cakes & Cupcakes','cake'),
      ('recipe-fillings','Fillings','filling'),
      ('recipe-preps%20%26%20fillings','Preps & fillings','filling'),
      ('recipe-preps%2C%20fillings%20%26%20toppings','Preps, Fillings & Toppings','filling')
     ) AS defaults(id,name,icon) LOOP
      IF EXISTS (SELECT 1 FROM recipes WHERE business_id=business.id AND data->>'recipeCategoryId'=implicit.id)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(categories) WHERE value->>'id'=implicit.id) THEN
       categories := categories || jsonb_build_array(jsonb_build_object('id',implicit.id,'name',implicit.name,'icon',implicit.icon,'active',true,'previousNames','[]'::jsonb));
      END IF;
     END LOOP;
     FOR implicit IN SELECT * FROM (VALUES
      ('recipe-breads%20%26%20rolls','Breads & Rolls','bread'),
      ('recipe-cakes%20%26%20cupcakes','Cakes & Cupcakes','cake')
     ) AS defaults(id,name,icon) LOOP
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(categories) WHERE pg_temp.pantry_category_name(value->>'name')=implicit.name)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(categories) WHERE value->>'name'=implicit.name) THEN
       categories := categories || jsonb_build_array(jsonb_build_object('id',implicit.id,'name',implicit.name,'icon',implicit.icon,'active',true,'previousNames','[]'::jsonb));
      END IF;
     END LOOP;
    END IF;
    IF field='pantryCategories' THEN
     FOR implicit IN SELECT data->>'sectionCategoryId' AS id, data->>'category' AS name,
      CASE WHEN data->>'usedAs'='material' THEN 'handmade-materials' WHEN data->>'usedAs'='packaging' THEN 'packaging' ELSE 'food-ingredients' END AS scope
      FROM ingredients WHERE business_id=business.id AND data->>'sectionCategoryId' LIKE 'pantry-%'
       AND lower(btrim(data->>'category')) IN ('breads','breads & rolls','cakes','cakes & cupcakes','fillings','preps & fillings','preps, fillings & toppings') LOOP
      IF implicit.id='pantry-'||implicit.scope||'-'||replace(replace(replace(implicit.name,' ','%20'),'&','%26'),',','%2C')
       AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(categories) WHERE value->>'id'=implicit.id) THEN
       categories := categories || jsonb_build_array(jsonb_build_object('id',implicit.id,'name',implicit.name,'scope',implicit.scope,'active',true,'previousNames','[]'::jsonb));
      END IF;
     END LOOP;
    END IF;
    merged := '[]'::jsonb; redirects := '{}'::jsonb;
    FOR c IN SELECT value FROM jsonb_array_elements(categories) LOOP
     IF redirects ? (c->>'id') THEN CONTINUE; END IF;
     SELECT value INTO destination FROM jsonb_array_elements(categories)
      WHERE lower(pg_temp.pantry_category_name(value->>'name'))=lower(pg_temp.pantry_category_name(c->>'name'))
       AND coalesce(value->>'scope','')=coalesce(c->>'scope','')
       AND coalesce(value->>'parentId','')=coalesce(c->>'parentId','')
      ORDER BY (value->>'name'=pg_temp.pantry_category_name(c->>'name')) DESC,
       (lower(btrim(value->>'name'))=lower(pg_temp.pantry_category_name(c->>'name'))) DESC,
       (lower(btrim(value->>'name'))='preps & fillings') DESC
      LIMIT 1;
     SELECT coalesce(jsonb_agg(DISTINCT to_jsonb(n)), '[]'::jsonb) INTO aliases FROM (
      SELECT value->>'name' AS n FROM jsonb_array_elements(categories)
       WHERE lower(pg_temp.pantry_category_name(value->>'name'))=lower(pg_temp.pantry_category_name(c->>'name'))
        AND coalesce(value->>'scope','')=coalesce(c->>'scope','')
        AND coalesce(value->>'parentId','')=coalesce(c->>'parentId','')
      UNION SELECT jsonb_array_elements_text(coalesce(value->'previousNames','[]'::jsonb))
       FROM jsonb_array_elements(categories)
       WHERE lower(pg_temp.pantry_category_name(value->>'name'))=lower(pg_temp.pantry_category_name(c->>'name'))
        AND coalesce(value->>'scope','')=coalesce(c->>'scope','')
        AND coalesce(value->>'parentId','')=coalesce(c->>'parentId','')
     ) names WHERE n<>pg_temp.pantry_category_name(c->>'name');
     destination := destination || jsonb_build_object('name',pg_temp.pantry_category_name(c->>'name'),'previousNames',aliases);
     merged := merged || jsonb_build_array(destination);
     SELECT redirects || coalesce(jsonb_object_agg(value->>'id',destination),'{}'::jsonb) INTO redirects
      FROM jsonb_array_elements(categories)
      WHERE lower(pg_temp.pantry_category_name(value->>'name'))=lower(pg_temp.pantry_category_name(c->>'name'))
       AND coalesce(value->>'scope','')=coalesce(c->>'scope','')
       AND coalesce(value->>'parentId','')=coalesce(c->>'parentId','');
    END LOOP;
    SELECT coalesce(jsonb_agg(CASE WHEN redirects ? (value->>'parentId')
     THEN value || jsonb_build_object('parentId', redirects->(value->>'parentId')->>'id') ELSE value END),'[]'::jsonb)
     INTO merged FROM jsonb_array_elements(merged);
    FOR r IN EXECUTE format('SELECT id,data FROM %I WHERE business_id=$1',table_name) USING business.id LOOP
     target := NULL; next_data := r.data;
     IF coalesce(r.data->>reference,'')<>'' THEN
      target := redirects->(r.data->>reference);
     ELSE
      SELECT CASE WHEN count(*)=1 THEN jsonb_agg(value)->0 END INTO target FROM jsonb_array_elements(merged)
       WHERE lower(btrim(value->>'name'))=lower(pg_temp.pantry_category_name(r.data->>'category'))
        AND lower(btrim(r.data->>'category')) IN ('breads','breads & rolls','cakes','cakes & cupcakes','fillings','preps & fillings','preps, fillings & toppings');
     END IF;
     IF target IS NOT NULL AND (
      target->>'id' IS DISTINCT FROM r.data->>reference
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(categories) WHERE value->>'id'=r.data->>reference AND value->>'name' IS DISTINCT FROM pg_temp.pantry_category_name(value->>'name'))
      OR (lower(btrim(r.data->>'category')) IN ('breads','breads & rolls','cakes','cakes & cupcakes','fillings','preps & fillings','preps, fillings & toppings')
       AND lower(btrim(target->>'name')) IN ('breads','breads & rolls','cakes','cakes & cupcakes','fillings','preps & fillings','preps, fillings & toppings'))
     ) THEN
      next_data := next_data || jsonb_build_object(reference,target->>'id','category',target->>'name');
     ELSIF coalesce(r.data->>reference,'')='' AND lower(btrim(r.data->>'category')) IN ('breads','breads & rolls','cakes','cakes & cupcakes','fillings','preps & fillings','preps, fillings & toppings') THEN
      next_data := next_data || jsonb_build_object('category',pg_temp.pantry_category_name(r.data->>'category'));
     END IF;
     IF table_name='ingredients' AND next_data IS DISTINCT FROM r.data THEN
      IF r.data->>'categoryId'=r.data->>reference THEN
       next_data := next_data || jsonb_build_object('categoryId',next_data->>reference);
      END IF;
      IF r.data->>'usedAs'='material' AND (r.data->>'materialCategory'=r.data->>'category' OR lower(btrim(r.data->>'materialCategory')) IN ('breads','breads & rolls','cakes','cakes & cupcakes','fillings','preps & fillings','preps, fillings & toppings')) THEN
       next_data := next_data || jsonb_build_object('materialCategory',next_data->>'category');
      END IF;
     END IF;
     IF next_data IS DISTINCT FROM r.data THEN
      EXECUTE format('UPDATE %I SET data=$1 WHERE business_id=$2 AND id=$3',table_name) USING next_data,business.id,r.id;
      count_key := coalesce(nullif(pg_temp.pantry_category_name(r.data->>'category'),''),target->>'name','Unspecified');
      counts := jsonb_set(counts,ARRAY[count_key],to_jsonb(coalesce((counts->>count_key)::integer,0)+1));
     END IF;
    END LOOP;
    IF merged IS DISTINCT FROM coalesce(settings_data->field,'[]'::jsonb) THEN
     settings_data := settings_data || jsonb_build_object(field,merged,revision,coalesce((settings_data->>revision)::integer,0)+1);
    END IF;
   END LOOP;
   settings_data := settings_data || jsonb_build_object('categoryConsolidationCounts',counts);
   IF settings_data IS DISTINCT FROM config.data THEN
    UPDATE settings SET data=settings_data WHERE business_id=business.id AND id=config.id;
   END IF;
  END LOOP;
 END LOOP;
END $$;
DROP FUNCTION pg_temp.pantry_category_name(text);
