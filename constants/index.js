export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  UNPROCESSABLE: 422,
  SERVICE_UNAVAILABLE: 503,
};

export const MESSAGES = {
  SUPABASE_AUTH_REQUIRED: 'Authentication is completed in the Supabase client (e.g. Google OAuth). Send a valid Bearer access token for API calls.',
  REGISTER_VIA_SUPABASE: 'User registration is handled by Supabase Auth from the client application.',
};
