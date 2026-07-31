import { Email } from '../models/Email.js';
import { EmailJob } from '../models/EmailJob.js';
import { emailQueue } from '../workers/emailQueue.js';
import { parseCsv } from '../utils/csvParser.js';

export class EmailController {
  static async sendSingle(req, res) {
    try {
      const { from, to, subject, bodyText, bodyHtml, threadId } = req.body;
      
      await emailQueue.add('send-single', {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        bodyText,
        bodyHtml,
        threadId,
      });

      res.status(200).json({ success: true, message: 'Email queued for sending.' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  }

  static async uploadBulkCsv(req, res) {
    try {
      const csvString = req.body; // Expecting raw text/csv
      const { from, subject, bodyTemplateHtml, bodyTemplateText, name, emailColumn } = req.query;

      if (!csvString || typeof csvString !== 'string') {
        return res.status(400).json({ error: 'Invalid CSV data. Send as text/csv or raw text.' });
      }

      const rows = parseCsv(csvString);
      if (rows.length === 0) {
        return res.status(400).json({ error: 'Empty CSV or invalid format.' });
      }

      const emailJob = await EmailJob.create({
        name: name || `Bulk Campaign - ${new Date().toISOString()}`,
        status: 'processing',
        totalEmails: rows.length,
        createdBy: req.user?._id || 'admin'
      });

      // Add to queue
      for (const row of rows) {
        let text = bodyTemplateText || '';
        let html = bodyTemplateHtml || '';
        
        // Basic templating
        Object.keys(row).forEach(key => {
          const regex = new RegExp(`{{${key}}}`, 'g');
          text = text.replace(regex, row[key]);
          html = html.replace(regex, row[key]);
        });
        
        const toEmail = emailColumn ? row[emailColumn] : (row.email || row.Email);

        if (toEmail) {
          await emailQueue.add('send-bulk', {
            from,
            to: [toEmail],
            subject,
            bodyText: text,
            bodyHtml: html,
            jobId: emailJob._id
          });
        }
      }

      res.status(200).json({ success: true, job: emailJob, queuedCount: rows.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
    }
  }

  static async getJobProgress(req, res) {
    try {
      const { jobId } = req.params;
      const job = await EmailJob.findById(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      
      res.status(200).json({ job });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  static async getEmails(req, res) {
    try {
      const { folder = 'sent', threadId } = req.query;
      const filter = {};
      if (folder) filter.folder = folder;
      if (threadId) filter.threadId = threadId;

      const emails = await Email.find(filter).sort({ createdAt: -1 }).limit(100);
      res.status(200).json({ emails });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}
