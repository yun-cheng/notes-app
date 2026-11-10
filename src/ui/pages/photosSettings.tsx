import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { usePhotoState } from '../../state/CardsContext';
import { disconnectDrive, fetchDriveStatus, startDriveConnect, type DriveStatus } from '../../sync/http';
import { Section } from '../components';
import { useToast } from '../Toast';

const RESULT: Record<string, string> = {
  connected: 'Google Drive is connected. Waiting photos will upload now.',
  denied: 'Google Drive was not connected.',
  expired: 'That took too long. Try connecting Google Drive again.',
  failed: "Google Drive couldn't be connected. Try again.",
};

/** Settings: where photos are stored, and any waiting to upload. */
export function PhotosSection() {
  const toast = useToast();
  const navigate = useNavigate();
  const { search, pathname } = useLocation();
  const { pending, problem } = usePhotoState();
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    fetchDriveStatus().then(setDrive, () => setOffline(true));
  }, []);

  // Google sends the browser back here with the result of connecting.
  useEffect(() => {
    const result = new URLSearchParams(search).get('drive');
    if (!result) return;
    toast(RESULT[result] ?? RESULT.failed);
    void navigate(pathname, { replace: true });
  }, [search, pathname, navigate, toast]);

  const connect = async () => {
    try {
      location.href = await startDriveConnect();
    } catch {
      toast("Couldn't start connecting. Check your connection and try again.");
    }
  };

  const disconnect = async () => {
    try {
      await disconnectDrive();
      setDrive((d) => d && { ...d, connected: false, email: null });
      toast('Google Drive disconnected. Photos already there stay in your Drive.');
    } catch {
      toast("Couldn't disconnect. Check your connection and try again.");
    }
  };

  const waiting = pending ? `${pending} ${pending === 1 ? 'photo is' : 'photos are'} waiting to upload` : '';
  const why =
    problem === 'needs_drive'
      ? ' until Google Drive is connected.'
      : problem === 'not_configured'
        ? ' until photo storage is set up on the server.'
        : problem === 'offline'
          ? ' until you are back online.'
          : problem === 'error'
            ? '. Some uploads failed and will be retried.'
            : '.';

  return (
    <Section title="Photos">
      <p className="prose-note">
        Photos are saved on this device first, then uploaded to a folder called “Notes app photos” in the Google Drive of the vault's owner. The app can
        only see files it created there.
      </p>
      {offline && <p className="prose-note vault-gap">Connect to the internet to see whether Google Drive is connected.</p>}
      {drive && !drive.configured && <p className="prose-note vault-gap">Photo storage isn't set up on the server yet, so photos stay on the device that added them for now.</p>}
      {drive?.configured && (
        <div className="button-row vault-gap">
          {drive.connected ? (
            <>
              <span className="prose-note">Connected{drive.email ? ` to ${drive.email}` : ''}.</span>
              <button type="button" className="btn" onClick={() => void disconnect()}>
                Disconnect Google Drive
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => void connect()}>
              Connect Google Drive
            </button>
          )}
        </div>
      )}
      {waiting && <p className="prose-note vault-gap">{waiting + why}</p>}
    </Section>
  );
}
