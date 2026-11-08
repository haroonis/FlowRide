import { useEffect, useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { kindOf, save } from '../store';
import { Alert, Spinner } from '../ui';

/** Opening a private link (/m/<token>) saves it on this device, then shows My rides. */
export default function ManageLink({ token }: { token: string }) {
  const [error, setError] = useState('');
  useEffect(() => {
    api.me(token).then(v => {
      save({ token, kind: kindOf(token), eventId: v.event.id, title: v.event.title, startsAt: v.event.starts_at });
      navigate('/me', true); // also removes the secret from the address bar
    }, e => setError(e.message));
  }, [token]);
  return error ? <Alert>{error}</Alert> : <Spinner label="Opening your ride…" />;
}
