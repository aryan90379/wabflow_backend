import { Email } from '../models/Email.js';
import { EmailJob } from '../models/EmailJob.js';
import { emailQueue } from '../workers/emailQueue.js';
import { parseCsv } from '../utils/csvParser.js';
import { simpleParser } from 'mailparser';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { broadcastGlobal } from '../services/socketService.js';
import crypto from 'crypto';

const s3Client = new S3Client({
  region: env.awsRegion,
  credentials: {
    accessKeyId: env.awsAccessKeyId,
    secretAccessKey: env.awsSecretAccessKey,
  },
});

export class EmailController {
  static async sendSingle(req, res) {
    try {
      const { from, to, cc, bcc, subject, bodyText, bodyHtml, threadId } = req.body;
      
      const trackingId = new mongoose.Types.ObjectId().toString(); // Use a new ID or actual email ID
      const trackingPixel = `<img src="https://api.wabflow.synqra.in/api/admin/email/track/${trackingId}.png" width="1" height="1" style="display:none;" />`;
      
      let finalHtml = bodyHtml || '';
      if (finalHtml && !finalHtml.includes('api/admin/email/track')) {
         finalHtml += trackingPixel;
      }
      
      await emailQueue.add('send-single', {
        _id: trackingId,
        from,
        to: Array.isArray(to) ? to : [to],
        cc: Array.isArray(cc) ? cc : (cc ? [cc] : []),
        bcc: Array.isArray(bcc) ? bcc : (bcc ? [bcc] : []),
        subject,
        bodyText,
        bodyHtml: finalHtml,
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
      const { folder = 'sent', threadId, search, page = 1, limit = 50 } = req.query;
      const filter = {};
      
      if (threadId && threadId !== 'undefined') {
        const orConditions = [{ threadId: threadId }, { messageId: threadId }];
        if (/^[0-9a-fA-F]{24}$/.test(threadId)) {
          orConditions.push({ _id: threadId });
        }
        filter.$or = orConditions;
      } else {
        if (folder && folder !== 'all') {
          filter.folder = folder;
        }
        if (search) {
          const searchRegex = { $regex: search, $options: 'i' };
          filter.$or = [
            { subject: searchRegex },
            { bodyText: searchRegex },
            { from: searchRegex }
          ];
        }
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const emails = await Email.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));
        
      const totalCount = await Email.countDocuments(filter);
      const hasNextPage = skip + emails.length < totalCount;

      res.status(200).json({ emails, totalCount, hasNextPage });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  static async deleteEmail(req, res) {
    try {
      const { id } = req.params;
      const { type } = req.query; // 'thread' or 'single'
      
      if (type === 'thread') {
        // Delete all emails in the thread. id can be threadId or messageId
        await Email.deleteMany({
          $or: [{ threadId: id }, { messageId: id }]
        });
      } else {
        await Email.findByIdAndDelete(id);
      }
      
      res.status(200).json({ success: true, message: 'Deleted successfully' });
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

        let bodyText = 'Incoming email received via AWS SES. (Body extraction requires S3 or Raw config in SES)';
        let bodyHtml = '';
        let attachmentsToSave = [];

        if (message.content) {
          try {
            let rawMime = message.content;
            if (!rawMime.includes('From:') && !rawMime.includes('Return-Path:') && !rawMime.includes('DKIM-Signature:')) {
               rawMime = Buffer.from(message.content, 'base64').toString('utf8');
            }

            const parsedMail = await simpleParser(rawMime);
            bodyText = parsedMail.text || bodyText;
            bodyHtml = parsedMail.html || parsedMail.textAsHtml || bodyText;
            
            // Handle Attachments
            if (parsedMail.attachments && parsedMail.attachments.length > 0) {
              for (const attachment of parsedMail.attachments) {
                const uniqueFilename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${attachment.filename || 'attachment'}`;
                const uploadParams = {
                  Bucket: env.awsS3Bucket,
                  Key: `emails/${uniqueFilename}`,
                  Body: attachment.content,
                  ContentType: attachment.contentType,
                  ContentDisposition: `inline; filename="${attachment.filename || 'attachment'}"`,
                };
                
                await s3Client.send(new PutObjectCommand(uploadParams));
                const url = `https://${env.awsS3Bucket}.s3.${env.awsRegion}.amazonaws.com/emails/${uniqueFilename}`;
                
                attachmentsToSave.push({
                  filename: attachment.filename || 'attachment',
                  url: url,
                  contentType: attachment.contentType,
                  size: attachment.size
                });
              }
            }
          } catch (err) {
            console.error('Failed to parse MIME content:', err);
            bodyText = 'Error parsing incoming email content.';
            bodyHtml = bodyText;
          }
        }
        
        const newEmail = await Email.create({
          messageId,
          threadId: threadId || messageId,
          from,
          to,
          subject,
          bodyText,
          bodyHtml,
          attachments: attachmentsToSave,
          folder: 'inbox',
          status: 'delivered'
        });

        console.log(`[Email] Received email from ${from} regarding ${subject}`);
        broadcastGlobal('new_email', newEmail);
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('SES Webhook Error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  static async trackOpen(req, res) {
    try {
      const { id } = req.params;
      const emailId = id.replace('.png', '');
      
      // Update the email to marked as opened if it exists
      if (/^[0-9a-fA-F]{24}$/.test(emailId)) {
        await Email.findByIdAndUpdate(emailId, {
          $set: { opened: true },
          $currentDate: { openedAt: true }
        });
      }

      // 1x1 transparent PNG
      const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': pixel.length,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      });
      res.end(pixel);
    } catch (error) {
      // Always return the pixel even if error
      const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(pixel);
    }
  }
}
