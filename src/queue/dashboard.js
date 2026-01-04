import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { crawlQueue } from './setup.js';

const runDashboard = () => {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(crawlQueue)],
    serverAdapter: serverAdapter,
  });

  const app = express();

  app.use('/admin/queues', serverAdapter.getRouter());

  app.listen(3000, () => {
    console.log('\x1b[35m%s\x1b[0m', '📊 Dashboard disponible sur http://localhost:3000/admin/queues');
  });
};

export default runDashboard;