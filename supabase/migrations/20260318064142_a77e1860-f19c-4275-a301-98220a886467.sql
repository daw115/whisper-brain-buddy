UPDATE storage.objects 
SET name = replace(name, '6b4a4315-305f-4776-9f1e-79878328d3bf/', '2afbbd4c-e252-4ebe-80dc-b62461acb311/'),
    owner = '2afbbd4c-e252-4ebe-80dc-b62461acb311',
    owner_id = '2afbbd4c-e252-4ebe-80dc-b62461acb311'
WHERE bucket_id = 'recordings' 
  AND name LIKE '6b4a4315-305f-4776-9f1e-79878328d3bf/%';
