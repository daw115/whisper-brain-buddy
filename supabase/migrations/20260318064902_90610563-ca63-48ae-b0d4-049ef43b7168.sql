-- Move meetings back to the currently logged-in account
UPDATE meetings SET user_id = '6b4a4315-305f-4776-9f1e-79878328d3bf' WHERE user_id = '2afbbd4c-e252-4ebe-80dc-b62461acb311';
UPDATE action_items SET user_id = '6b4a4315-305f-4776-9f1e-79878328d3bf' WHERE user_id = '2afbbd4c-e252-4ebe-80dc-b62461acb311';

-- Move storage files back
UPDATE storage.objects 
SET name = replace(name, '2afbbd4c-e252-4ebe-80dc-b62461acb311/', '6b4a4315-305f-4776-9f1e-79878328d3bf/'),
    owner = '6b4a4315-305f-4776-9f1e-79878328d3bf',
    owner_id = '6b4a4315-305f-4776-9f1e-79878328d3bf'
WHERE bucket_id = 'recordings' 
  AND name LIKE '2afbbd4c-e252-4ebe-80dc-b62461acb311/%';
