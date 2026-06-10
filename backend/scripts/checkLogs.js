import { getPrisma } from '../src/providers/postgresProvider.js';

async function main() {
  try {
    const prisma = await getPrisma();
    console.log('Querying pg_stat_activity...');
    
    const activeQueries = await prisma.$queryRaw`
      SELECT 
        pid, 
        age(clock_timestamp(), query_start)::text as duration, 
        usename, 
        state, 
        query 
      FROM pg_stat_activity 
      WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%';
    `;
    
    console.log(`Active queries count: ${activeQueries.length}`);
    activeQueries.forEach((q) => {
      console.log(`\nPID: ${q.pid} | Duration: ${q.duration} | State: ${q.state}`);
      console.log(`Query: ${q.query}`);
    });

    console.log('\nQuerying database lock status...');
    const locks = await prisma.$queryRaw`
      SELECT
        coalesce(blockingl.relation::regclass::text,blockingg.database::text) as locked_item,
        blockingt.pid as blocking_pid,
        blockingt.query as blocking_query,
        blockedl.pid as blocked_pid,
        blockedt.query as blocked_query
      FROM pg_catalog.pg_locks blockedl
      JOIN pg_catalog.pg_stat_activity blockedt ON blockedt.pid = blockedl.pid
      LEFT JOIN pg_catalog.pg_locks blockingl ON blockingl.pid != blockedl.pid
        AND (blockingl.relation = blockedl.relation OR blockingl.page = blockedl.page
          AND blockingl.tuple = blockedl.tuple OR blockingl.transactionid = blockedl.transactionid
          AND blockingl.classid = blockedl.classid OR blockingl.objid = blockedl.objid
          AND blockingl.objsubid = blockedl.objsubid)
      LEFT JOIN pg_catalog.pg_stat_activity blockingt ON blockingt.pid = blockingl.pid
      LEFT JOIN pg_catalog.pg_locks blockingg ON blockingg.pid = blockingl.pid
      WHERE NOT blockedl.granted;
    `;
    
    console.log(`Blocked queries count: ${locks.length}`);
    locks.forEach((l) => {
      console.log(`\nLocked Item: ${l.locked_item}`);
      console.log(`Blocking PID: ${l.blocking_pid} | Blocking Query: ${l.blocking_query}`);
      console.log(`Blocked PID: ${l.blocked_pid} | Blocked Query: ${l.blocked_query}`);
    });

  } catch (err) {
    console.error('Error reading stats:', err);
  }
}

main();
