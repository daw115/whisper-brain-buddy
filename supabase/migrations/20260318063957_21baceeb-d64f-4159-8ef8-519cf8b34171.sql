-- Transfer meetings and related data to Dawid's account
UPDATE meetings SET user_id = '2afbbd4c-e252-4ebe-80dc-b62461acb311' WHERE user_id = '6b4a4315-305f-4776-9f1e-79878328d3bf';
UPDATE action_items SET user_id = '2afbbd4c-e252-4ebe-80dc-b62461acb311' WHERE user_id = '6b4a4315-305f-4776-9f1e-79878328d3bf';
