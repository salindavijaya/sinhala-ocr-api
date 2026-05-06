'use strict';

const Joi = require('joi');

const registerSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required()
    .messages({
      'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one digit',
    }),
});

const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

const createApiKeySchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
});

const transcribeSchema = Joi.object({
  output_format: Joi.string().valid('json', 'docx', 'pdf', 'all').default('all'),
  language_hint: Joi.string().valid('si', 'si-LK').default('si'),
  preserve_layout: Joi.boolean().default(false),
});

const validate = (schema) => (req, res, next) => {
  const target = req.method === 'GET' ? req.query : req.body;
  const { error, value } = schema.validate(target, {
    abortEarly: false,
    stripUnknown: true,
    allowUnknown: false,
  });

  if (error) {
    const details = error.details.map((d) => ({
      field: d.path.join('.'),
      message: d.message.replace(/['"]/g, ''),
    }));
    const { validationError } = require('./apiResponse');
    return validationError(res, details);
  }

  // Merge validated/sanitised values back onto request
  if (req.method === 'GET') {
    req.query = value;
  } else {
    req.body = value;
  }
  next();
};

module.exports = {
  registerSchema,
  loginSchema,
  createApiKeySchema,
  transcribeSchema,
  validate,
};
