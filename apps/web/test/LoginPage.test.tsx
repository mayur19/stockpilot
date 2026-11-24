import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth/AuthProvider';
import { LoginPage } from '../src/pages/LoginPage';

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/stock" element={<p>Stock screen</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('shows the server error message on bad credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/me'))
        return json(401, {
          data: null,
          error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
        });
      return json(401, {
        data: null,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' },
      });
    });
    renderLogin();
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('navigates to the stock screen after a successful login', async () => {
    let signedIn = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) {
        signedIn = true;
        return json(200, { data: { csrfToken: 'x' }, error: null });
      }
      if (signedIn) {
        return json(200, {
          data: {
            user: { id: 'u', email: 'a@b.test', name: 'A', role: 'owner' },
            organization: { id: 'o', name: 'Org' },
          },
          error: null,
        });
      }
      return json(401, { data: null, error: { code: 'UNAUTHENTICATED', message: 'no' } });
    });
    renderLogin();
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('Stock screen')).toBeInTheDocument());
  });
});
