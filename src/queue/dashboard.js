
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { crawlQueue } from './setup.js';

function setupBullBoard(app) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');

    createBullBoard({
        queues: [new BullMQAdapter(crawlQueue)],
        serverAdapter: serverAdapter,
    });

    app.use('/admin/queues', serverAdapter.getRouter());
    
    return app;
}

export default setupBullBoard;
