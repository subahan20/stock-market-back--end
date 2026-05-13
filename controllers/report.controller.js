import * as reportService from '../services/report.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function aiEmailReportSend(req, res) {
  const data = await reportService.sendAiInsightsEmail({
    user: req.user,
    name: req.body.name,
    email: req.body.email,
  });
  const message =
    data.status === 'sent'
      ? 'AI insights digest emailed successfully'
      : data.status === 'queued'
        ? 'Email is queued. Configure SMTP_HOST/SMTP_USER/SMTP_PASS on the server to enable delivery.'
        : 'Email delivery failed; the attempt has been logged.';
  sendSuccess(res, data, message);
}
