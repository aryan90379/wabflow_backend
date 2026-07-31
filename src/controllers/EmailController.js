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
      
      if (threadId && threadId !== 'undefined') {
        // Fetch specific thread or email by ID
        const orConditions = [{ threadId: threadId }, { messageId: threadId }];
        
        // Only query _id if threadId is a valid ObjectId (24 hex chars)
        if (/^[0-9a-fA-F]{24}$/.test(threadId)) {
          orConditions.push({ _id: threadId });
        }
        
        filter.$or = orConditions;
      } else if (folder) {
        // Default to folder filter if no threadId
        filter.folder = folder;
      }

      const emails = await Email.find(filter).sort({ createdAt: -1 }).limit(100);
      res.status(200).json({ emails });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  static async handleIncomingWebhook(req, res) {
    try {
      const payload = req.body;

      // Handle AWS SNS Subscription Confirmation
      if (payload.Type === 'SubscriptionConfirmation' && payload.SubscribeURL) {
        console.log('AWS SNS SubscriptionConfirmation received, verifying...');
        const response = await fetch(payload.SubscribeURL);
        if (response.ok) {
          console.log('AWS SNS webhook verified successfully.');
          return res.status(200).send('Verified');
        } else {
          return res.status(400).send('Verification failed');
        }
      }

      // Handle actual SES Notification (Standard SNS Envelope)
      let message = null;
      if (payload.Type === 'Notification' && payload.Message) {
        try {
          message = JSON.parse(payload.Message);
        } catch(e) {}
      } else if (payload.notificationType === 'Received') {
        // Handle SNS Raw Message Delivery
        message = payload;
      }
      
      if (message && message.notificationType === 'Received' && message.mail) {
        const mail = message.mail;
        const headers = mail.commonHeaders || {};
        const allHeaders = mail.headers || []; // Array of {name, value}

        const from = headers.from ? headers.from.join(', ') : 'unknown@example.com';
        const to = headers.to || [];
        const subject = headers.subject || 'No Subject';
        const messageId = mail.messageId;

        // Attempt to find In-Reply-To to map to a thread
        const inReplyToHeader = allHeaders.find(h => h.name.toLowerCase() === 'in-reply-to');
        const inReplyTo = inReplyToHeader ? inReplyToHeader.value.trim().replace(/[<>]/g, '') : null;

        let threadId = null;
        if (inReplyTo) {
          // Find the original email we sent that this is replying to
          const originalEmail = await Email.findOne({ messageId: inReplyTo });
          if (originalEmail) {
            threadId = originalEmail.threadId || originalEmail._id;
          }
        }

        let bodyText = message.content || 'Incoming email received via AWS SES. (Body extraction requires S3 or Raw config in SES)';
        
        await Email.create({
          messageId,
          threadId: threadId || messageId, // Use original thread, or start a new one
          from,
          to,
          subject,
          bodyText,
          bodyHtml: bodyText,
          folder: 'inbox',
          status: 'delivered'
        });

        console.log(`[Email] Received email from ${from} regarding ${subject}`);
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('SES Webhook Error:', error);
      res.status(500).json({ error: error.message });
    }
  }
}
