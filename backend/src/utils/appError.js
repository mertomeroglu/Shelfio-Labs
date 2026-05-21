export class AppError extends Error {
  constructor(statusCode, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    if (details && typeof details === 'object') {
      Object.assign(this, details);
    }
  }
}

export const createNotFoundError = (message = 'Kayıt bulunamadı') => new AppError(404, message);
