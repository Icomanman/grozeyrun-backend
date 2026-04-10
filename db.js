
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
const sql = postgres(connectionString);

if (!sql){
  throw new Error('> Failed to connect to the database.');
}
export default sql;