select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'students'
order by ordinal_position;
