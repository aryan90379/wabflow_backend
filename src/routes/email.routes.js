import express from 'express';
import { EmailController } from '../controllers/EmailController.js';

const router = express.Router();

// Parse raw text for CSV uploads
router.post('/bulk', express.text({ type: 'text/csv', limit: '10mb' }), EmailController.uploadBulkCsv);

router.post('/single', express.json(), EmailController.sendSingle);
router.get('/jobs/:jobId', EmailController.getJobProgress);
router.get('/', EmailController.getEmails);

router.post('/incoming', express.json({type: ['application/json', 'text/plain']}), EmailController.handleIncomingWebhook);

export const emailRoutes = router;
