import { NextFunction, Request, Response } from 'express';
import { payeeSignatureAuth } from './payeeSignatureAuth';

jest.mock('../services/payeeSignature', () => ({
  verifyPayeeSignature: jest.fn(),
}));

import { verifyPayeeSignature } from '../services/payeeSignature';

const mockedVerify = verifyPayeeSignature as jest.Mock;

function makeRes(locals: Record<string, unknown> = {}): Response {
  const res = {
    locals,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('payeeSignatureAuth', () => {
  beforeEach(() => {
    mockedVerify.mockReset();
  });

  it('returns 500 when the API context is missing', async () => {
    const req = { body: { walletAddress: '0xabc' } } as Request;
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    await payeeSignatureAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it('calls next when the wallet address matches the API wallet', async () => {
    const req = { body: { walletAddress: '0xabc' } } as Request;
    const res = makeRes({ api: { id: 'api-1', walletAddress: '0xabc' } });
    const next = jest.fn() as NextFunction;

    await payeeSignatureAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects when the payee signature is missing', async () => {
    const req = { body: { walletAddress: '0xdef' } } as Request;
    const res = makeRes({ api: { id: 'api-1', walletAddress: '0xabc' } });
    const next = jest.fn() as NextFunction;

    await payeeSignatureAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects when the payee signature is invalid', async () => {
    mockedVerify.mockResolvedValue(false);
    const req = {
      body: { walletAddress: '0xdef', payeeSignature: 'sig' },
    } as Request;
    const res = makeRes({ api: { id: 'api-1', walletAddress: '0xabc' } });
    const next = jest.fn() as NextFunction;

    await payeeSignatureAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the payee signature is valid', async () => {
    mockedVerify.mockResolvedValue(true);
    const req = {
      body: { walletAddress: '0xdef', payeeSignature: 'sig' },
    } as Request;
    const res = makeRes({ api: { id: 'api-1', walletAddress: '0xabc' } });
    const next = jest.fn() as NextFunction;

    await payeeSignatureAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
