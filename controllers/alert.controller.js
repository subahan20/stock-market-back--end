import * as alertService from '../services/alert.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { mapAlertRow } from '../models/index.js';

export async function create(req, res) {
  const row = await alertService.createAlert(req.user.id, {
    symbol: req.body.symbol,
    thresholdType: req.body.thresholdType,
    thresholdValue: req.body.thresholdValue,
    note: req.body.note,
  });
  sendSuccess(res, mapAlertRow(row), 'Alert created', 201);
}

export async function list(req, res) {
  const rows = await alertService.listAlerts(req.user.id);
  sendSuccess(res, rows.map(mapAlertRow), 'Alerts');
}

export async function remove(req, res) {
  await alertService.deleteAlert(req.user.id, req.params.id);
  sendSuccess(res, { id: req.params.id }, 'Alert removed');
}
