import axios from 'axios';
import { env } from '../config/env.js';
import { signAwsV4 } from '../utils/awsSigV4.js';
import { Email } from '../models/Email.js';

const SES_ENDPOINT = `https://email.${env.awsRegion}.amazonaws.com/v2/email/outbound-emails`;

export class EmailService {
  /**
   * Sends an email using AWS SES v2 API
   * @param {Object} params 
   * @param {String} params.from
   * @param {String[]} params.to
   * @param {String} params.subject
   * @param {String} params.bodyText
   * @param {String} params.bodyHtml
   * @param {String} [params.threadId]
   * @param {String} [params.jobId]
   */
  static async sendEmail({ from, to, subject, bodyText, bodyHtml, threadId, jobId }) {
    if (!env.awsAccessKeyId || !env.awsSecretAccessKey) {
      throw new Error('AWS credentials are not configured');
    }

    const payload = {
      FromEmailAddress: from,
      Destination: {
        ToAddresses: to,
      },
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: {}
        }
      }
    };

    if (bodyHtml) {
      payload.Content.Simple.Body.Html = { Data: bodyHtml };
    }
    if (bodyText || !bodyHtml) {
      payload.Content.Simple.Body.Text = { Data: bodyText || bodyHtml.replace(/<[^>]+>/g, '') };
    }

    const requestParams = {
      method: 'POST',
      url: SES_ENDPOINT,
      body: JSON.stringify(payload),
      service: 'ses',
      region: env.awsRegion
    };

    const headers = signAwsV4(requestParams, {
      accessKeyId: env.awsAccessKeyId,
      secretAccessKey: env.awsSecretAccessKey
    });

    try {
      const response = await axios.post(SES_ENDPOINT, payload, { headers });
      const messageId = response.data.MessageId;

      const emailRecord = await Email.create({
        messageId,
        threadId,
        from,
        to,
        subject,
        bodyText,
        bodyHtml,
        folder: 'sent',
        status: 'sent',
        jobId
      });

      return emailRecord;
    } catch (error) {
      console.error('SES Send Email Error:', error?.response?.data || error.message);
      
      await Email.create({
        threadId,
        from,
        to,
        subject,
        bodyText,
        bodyHtml,
        folder: 'sent',
        status: 'failed',
        jobId,
        error: error?.response?.data?.message || error.message
      });

      throw error;
    }
  }
}
