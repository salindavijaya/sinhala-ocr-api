'use strict';

jest.mock('../../src/models/Job');
jest.mock('../../src/services/storage.service');
jest.mock('node-cron', () => ({ schedule: jest.fn().mockReturnValue({ stop: jest.fn() }) }));

const Job = require('../../src/models/Job');
const { deleteFile } = require('../../src/services/storage.service');
const { runPurge } = require('../../src/cron/purge.cron');

describe('purgeCron', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes GCS files for all expired jobs', async () => {
    Job.findExpired.mockResolvedValueOnce([
      { id: 'j1', gcs_input_path: 'up/j1.jpg', gcs_output_docx_path: 'out/j1.docx', gcs_output_pdf_path: null },
      { id: 'j2', gcs_input_path: 'up/j2.jpg', gcs_output_docx_path: null, gcs_output_pdf_path: 'out/j2.pdf' },
    ]);
    Job.markPurged.mockResolvedValue(undefined);
    deleteFile.mockResolvedValue(undefined);

    const result = await runPurge();

    expect(deleteFile).toHaveBeenCalledTimes(4); // j1: 2 files, j2: 2 files
    expect(Job.markPurged).toHaveBeenCalledWith('j1');
    expect(Job.markPurged).toHaveBeenCalledWith('j2');
    expect(result.purged).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('skips null GCS paths', async () => {
    Job.findExpired.mockResolvedValueOnce([
      { id: 'j1', gcs_input_path: null, gcs_output_docx_path: null, gcs_output_pdf_path: null },
    ]);
    Job.markPurged.mockResolvedValue(undefined);

    await runPurge();

    expect(deleteFile).not.toHaveBeenCalled();
    expect(Job.markPurged).toHaveBeenCalledWith('j1');
  });

  it('returns purged=0 errors=0 when no expired jobs', async () => {
    Job.findExpired.mockResolvedValueOnce([]);
    const result = await runPurge();
    expect(result).toEqual({ purged: 0, errors: 0 });
  });

  it('increments errors count when a job purge fails', async () => {
    Job.findExpired.mockResolvedValueOnce([
      { id: 'j1', gcs_input_path: 'up/j1.jpg', gcs_output_docx_path: null, gcs_output_pdf_path: null },
    ]);
    deleteFile.mockResolvedValue(undefined);
    Job.markPurged.mockRejectedValueOnce(new Error('DB error'));

    const result = await runPurge();
    expect(result.errors).toBe(1);
    expect(result.purged).toBe(0);
  });

  it('continues processing remaining jobs after one failure', async () => {
    Job.findExpired.mockResolvedValueOnce([
      { id: 'j1', gcs_input_path: 'up/j1.jpg', gcs_output_docx_path: null, gcs_output_pdf_path: null },
      { id: 'j2', gcs_input_path: 'up/j2.jpg', gcs_output_docx_path: null, gcs_output_pdf_path: null },
    ]);
    deleteFile.mockResolvedValue(undefined);
    Job.markPurged
      .mockRejectedValueOnce(new Error('DB error on j1'))
      .mockResolvedValueOnce(undefined);

    const result = await runPurge();
    expect(result.purged).toBe(1);
    expect(result.errors).toBe(1);
  });

  it('counts errors when findExpired itself throws', async () => {
    Job.findExpired.mockRejectedValueOnce(new Error('Connection lost'));
    const result = await runPurge();
    expect(result.errors).toBe(1);
    expect(result.purged).toBe(0);
  });
});
