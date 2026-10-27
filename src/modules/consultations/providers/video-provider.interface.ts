export interface VideoSessionMetadata {
  sessionId: string;
  roomName: string;
  token: string;
  expiresAt: Date;
  provider: 'MOCK_DAILY' | 'TWILIO' | 'AGORA';
}

export interface IVideoProvider {
  createSession(params: {
    consultationId: string;
    doctorId: string;
    patientId: string;
  }): Promise<VideoSessionMetadata>;

  endSession(sessionId: string): Promise<void>;
}
