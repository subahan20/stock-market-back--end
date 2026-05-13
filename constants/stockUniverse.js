/**
 * Reference metadata for search and display — not used as price source.
 * Quotes always come from live ingest (Twelve Data / Yahoo) + Supabase cache.
 * `region`: 'IN' → NSE-style Yahoo `.NS` + Twelve `NSE`; 'US' → plain Yahoo ticker + US Twelve pair.
 */
export const STOCK_UNIVERSE = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', region: 'US' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', region: 'US' },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Cyclical', region: 'US' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Technology', region: 'US' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', region: 'US' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Cyclical', region: 'US' },
  // Indian companies that also list as ADRs on NYSE — region:'US' so Finnhub routes them
  // for real-time quotes (USD-denominated; the NSE counterparts below stay on Twelve).
  { symbol: 'WIT', name: 'Wipro Ltd ADR (NYSE)', sector: 'IT', region: 'US' },
  { symbol: 'IBN', name: 'ICICI Bank Ltd ADR (NYSE)', sector: 'Banking', region: 'US' },
  { symbol: 'HDB', name: 'HDFC Bank Ltd ADR (NYSE)', sector: 'Banking', region: 'US' },
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', sector: 'Energy', region: 'IN' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', region: 'IN' },
  { symbol: 'INFY', name: 'Infosys Ltd', sector: 'IT', region: 'IN' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', sector: 'Banking', region: 'IN' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', sector: 'Banking', region: 'IN' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', region: 'IN' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', sector: 'Telecom', region: 'IN' },
  { symbol: 'ITC', name: 'ITC Ltd', sector: 'FMCG', region: 'IN' },
  { symbol: 'LT', name: 'Larsen & Toubro Ltd', sector: 'Infra', region: 'IN' },
  { symbol: 'WIPRO', name: 'Wipro Ltd', sector: 'IT', region: 'IN' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', sector: 'FMCG', region: 'IN' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd', sector: 'Auto', region: 'IN' },
];
