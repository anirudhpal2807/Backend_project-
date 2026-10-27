import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { IVideoProvider, VideoSessionMetadata } from './video-provider.interface';

@Injectable()
export class MockVideoProvider implements IVideoProvider {
  public async createSession(params: {
    consultationId: string;
    doctorId: string;
    patientId: string;
  }): Promise<VideoSessionMetadata> {
    const sessionId = `vid_${crypto.randomBytes(12).toString('hex')}`;
    const roomName = `amrutam-room-${params.consultationId.substring(0, 8)}`;
    const token = `mock_jwt_token_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    return {
      sessionId,
      roomName,
      token,
      expiresAt,
      provider: 'MOCK_DAILY',
    };
  }

  public async endSession(sessionId?: string): Promise<void> {
    void sessionId;
    return Promise.resolve();
  }
}
