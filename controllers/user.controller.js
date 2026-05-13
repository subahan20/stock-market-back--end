import * as userService from '../services/user.service.js';
import * as portfolioService from '../services/portfolio.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

export async function profile(req, res) {
  const data = await userService.getProfile(req.user);
  sendSuccess(res, data, 'Profile');
}

export async function portfolio(req, res) {
  const data = await portfolioService.listPortfolio(req.user.id);
  sendSuccess(res, data, 'Portfolio');
}

export async function watchlistGet(req, res) {
  const data = await userService.listWatchlist(req.user.id);
  sendSuccess(res, data, 'Watchlist');
}

export async function watchlistPost(req, res) {
  const data = await userService.addWatchlistItem(req.user.id, req.body.symbol);
  sendSuccess(res, data, 'Watchlist updated', 201);
}

export async function watchlistDelete(req, res) {
  const data = await userService.removeWatchlistItem(req.user.id, req.params.symbol);
  sendSuccess(res, data, 'Watchlist updated');
}
