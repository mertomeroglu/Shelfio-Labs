import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

export const signToken = (payload) => jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

export const verifyToken = (token) => jwt.verify(token, config.jwtSecret);

export const signCustomerRefreshToken = (payload) =>
  jwt.sign(payload, config.customerRefreshSecret, { expiresIn: config.customerRefreshExpiresIn });

export const verifyCustomerRefreshToken = (token) => jwt.verify(token, config.customerRefreshSecret);
