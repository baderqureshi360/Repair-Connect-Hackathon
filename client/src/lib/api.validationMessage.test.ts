import { describe, expect, it } from 'vitest';
import { formatValidationDetails, messageFromFailedResponse } from './apiErrors';

describe('validation error messaging', () => {
  it('formats Zod flatten details into a readable sentence', () => {
    expect(
      formatValidationDetails({
        formErrors: [],
        fieldErrors: {
          appointmentAt: ['Invalid datetime'],
          problemDescription: ['String must contain at least 5 character(s)']
        }
      })
    ).toContain('appointmentAt: Invalid datetime');
  });

  it('replaces bare Validation failed with field details', () => {
    const msg = messageFromFailedResponse(
      { status: 400, statusText: 'Bad Request' },
      {
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: {
            formErrors: [],
            fieldErrors: { appointmentAt: ['Invalid datetime'] }
          }
        }
      }
    );
    expect(msg).toBe('appointmentAt: Invalid datetime');
  });

  it('keeps specific API messages when already descriptive', () => {
    const msg = messageFromFailedResponse(
      { status: 400, statusText: 'Bad Request' },
      {
        success: false,
        error: {
          message: 'Appointment time: must be a valid date and time',
          code: 'VALIDATION_ERROR',
          details: { formErrors: [], fieldErrors: { appointmentAt: ['Invalid datetime'] } }
        }
      }
    );
    expect(msg).toBe('Appointment time: must be a valid date and time');
  });
});
