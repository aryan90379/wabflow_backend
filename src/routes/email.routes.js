import express from 'express';
import { EmailController } from '../controllers/EmailController.js';

const router = express.Router();

// Parse raw text for CSV uploads
router.post('/bulk', express.text({ type: 'text/csv', limit: '10mb' }), EmailController.uploadBulkCsv);

router.post('/single', express.json(), EmailController.sendSingle);
router.get('/jobs/:jobId', EmailController.getJobProgress);
router.get('/', EmailController.getEmails);
router.delete('/:id', EmailController.deleteEmail);

export const emailRoutes = router;
