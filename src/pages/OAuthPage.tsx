import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useNotificationStore, useThemeStore } from '@/stores';
import { oauthApi, type OAuthProvider } from '@/services/api/oauth';
import { authFilesApi } from '@/services/api/authFiles';
import { copyToClipboard } from '@/utils/clipboard';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import styles from './OAuthPage.module.scss';
import iconCodex from '@/assets/icons/codex.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconAntigravity from '@/assets/icons/antigravity.svg';
import iconOpenCode from '@/assets/icons/opencode.png';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';

interface ProviderState {
  url?: string;
  state?: string;
  status?: 'idle' | 'waiting' | 'success' | 'error';
  error?: string;
  polling?: boolean;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
}

interface OpenCodeManualState {
  accountName: string;
  workspaceID: string;
  cookie: string;
  apiKey: string;
  saving: boolean;
  status?: 'success' | 'error';
  error?: string;
  savedFile?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return typeof error === 'string' ? error : '';
}

function getErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

const PROVIDERS: {
  id: OAuthProvider;
  titleKey: string;
  hintKey: string;
  urlLabelKey: string;
  icon: string | { light: string; dark: string };
}[] = [
  {
    id: 'codex',
    titleKey: 'auth_login.codex_oauth_title',
    hintKey: 'auth_login.codex_oauth_hint',
    urlLabelKey: 'auth_login.codex_oauth_url_label',
    icon: iconCodex,
  },
  {
    id: 'anthropic',
    titleKey: 'auth_login.anthropic_oauth_title',
    hintKey: 'auth_login.anthropic_oauth_hint',
    urlLabelKey: 'auth_login.anthropic_oauth_url_label',
    icon: iconClaude,
  },
  {
    id: 'antigravity',
    titleKey: 'auth_login.antigravity_oauth_title',
    hintKey: 'auth_login.antigravity_oauth_hint',
    urlLabelKey: 'auth_login.antigravity_oauth_url_label',
    icon: iconAntigravity,
  },
  {
    id: 'xai',
    titleKey: 'auth_login.xai_oauth_title',
    hintKey: 'auth_login.xai_oauth_hint',
    urlLabelKey: 'auth_login.xai_oauth_url_label',
    icon: { light: iconGrok, dark: iconGrokDark },
  },
];

const CALLBACK_SUPPORTED: OAuthProvider[] = [
  'codex',
  'anthropic',
  'antigravity',
  'xai',
];
const XAI_CALLBACK_URL = 'http://127.0.0.1:56121/callback';
const SUCCESS_RESET_DELAY_MS = 5000;
const getProviderI18nPrefix = (provider: OAuthProvider) => provider.replace('-', '_');
const getAuthKey = (provider: OAuthProvider, suffix: string) =>
  `auth_login.${getProviderI18nPrefix(provider)}_${suffix}`;

const getIcon = (icon: string | { light: string; dark: string }, theme: 'light' | 'dark') => {
  return typeof icon === 'string' ? icon : icon[theme];
};

const buildOpenCodeAuthFileName = (accountName: string, workspaceID: string): string => {
  const slug = [accountName, workspaceID]
    .map((value) =>
      value
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60)
    )
    .find(Boolean);
  return `opencode-${slug || 'workspace'}.json`;
};

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const readQueryLikeCallbackInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const queryStart = trimmed.indexOf('?');
  const hashStart = trimmed.indexOf('#');
  const rawParams =
    queryStart >= 0
      ? trimmed.slice(queryStart + 1)
      : hashStart >= 0
        ? trimmed.slice(hashStart + 1)
        : trimmed;

  if (!/(^|[&#?])(code|state|error)=/i.test(rawParams)) return null;
  return new URLSearchParams(rawParams.replace(/^[?#]/, ''));
};

const extractDisplayedXaiCode = (value: string): string => {
  const trimmed = value.trim();
  const codeMatch = trimmed.match(/\bcode\s*[:=]\s*([^\s&]+)/i);
  return (codeMatch?.[1] ?? trimmed).trim();
};

const buildXaiCallbackUrl = (input: string, state?: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isAbsoluteUrl(trimmed)) return trimmed;

  const params = readQueryLikeCallbackInput(trimmed);
  if (params) {
    const code = params.get('code')?.trim();
    const error = params.get('error')?.trim();
    const errorDescription = params.get('error_description')?.trim();
    const callbackState = params.get('state')?.trim() || state?.trim();
    if (!callbackState) return null;

    const callbackUrl = new URL(XAI_CALLBACK_URL);
    callbackUrl.searchParams.set('state', callbackState);
    if (code) callbackUrl.searchParams.set('code', code);
    if (error) callbackUrl.searchParams.set('error', error);
    if (errorDescription) callbackUrl.searchParams.set('error_description', errorDescription);
    return callbackUrl.toString();
  }

  const code = extractDisplayedXaiCode(trimmed);
  const callbackState = state?.trim();
  if (!code || !callbackState) return null;

  const callbackUrl = new URL(XAI_CALLBACK_URL);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', callbackState);
  return callbackUrl.toString();
};

const resolveCallbackUrl = (
  provider: OAuthProvider,
  input: string,
  state?: string
): string | null => {
  if (provider !== 'xai') return input.trim();
  return buildXaiCallbackUrl(input, state);
};

export function OAuthPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [states, setStates] = useState<Record<OAuthProvider, ProviderState>>(
    {} as Record<OAuthProvider, ProviderState>
  );
  const [openCodeState, setOpenCodeState] = useState<OpenCodeManualState>({
    accountName: '',
    workspaceID: '',
    cookie: '',
    apiKey: '',
    saving: false,
  });
  const [showOpenCodeCookie, setShowOpenCodeCookie] = useState(false);
  const [showOpenCodeApiKey, setShowOpenCodeApiKey] = useState(false);
  const pollingTimers = useRef<Partial<Record<OAuthProvider, number>>>({});
  const successResetTimers = useRef<Partial<Record<OAuthProvider, number>>>({});

  const clearTimers = useCallback(() => {
    Object.values(pollingTimers.current).forEach((timer) => {
      if (timer !== undefined) window.clearInterval(timer);
    });
    Object.values(successResetTimers.current).forEach((timer) => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
    pollingTimers.current = {};
    successResetTimers.current = {};
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const updateProviderState = (provider: OAuthProvider, next: Partial<ProviderState>) => {
    setStates((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? {}), ...next },
    }));
  };

  const clearPollingTimer = (provider: OAuthProvider) => {
    const timer = pollingTimers.current[provider];
    if (timer !== undefined) {
      window.clearInterval(timer);
      delete pollingTimers.current[provider];
    }
  };

  const clearSuccessResetTimer = (provider: OAuthProvider) => {
    const timer = successResetTimers.current[provider];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete successResetTimers.current[provider];
    }
  };

  const clearProviderTimers = (provider: OAuthProvider) => {
    clearPollingTimer(provider);
    clearSuccessResetTimer(provider);
  };

  const resetProviderAttempt = (provider: OAuthProvider) => {
    clearProviderTimers(provider);
    setStates((prev) => {
      return {
        ...prev,
        [provider]: {},
      };
    });
  };

  const completeProviderAuth = (provider: OAuthProvider) => {
    clearPollingTimer(provider);
    clearSuccessResetTimer(provider);
    updateProviderState(provider, {
      url: undefined,
      state: undefined,
      status: 'success',
      error: undefined,
      polling: false,
      callbackUrl: '',
      callbackSubmitting: false,
      callbackStatus: undefined,
      callbackError: undefined,
    });
    successResetTimers.current[provider] = window.setTimeout(() => {
      resetProviderAttempt(provider);
    }, SUCCESS_RESET_DELAY_MS);
  };

  const startPolling = (provider: OAuthProvider, state: string) => {
    clearPollingTimer(provider);
    const timer = window.setInterval(async () => {
      try {
        const res = await oauthApi.getAuthStatus(state);
        if (res.status === 'ok') {
          completeProviderAuth(provider);
          showNotification(t(getAuthKey(provider, 'oauth_status_success')), 'success');
        } else if (res.status === 'error') {
          updateProviderState(provider, { status: 'error', error: res.error, polling: false });
          showNotification(
            `${t(getAuthKey(provider, 'oauth_status_error'))} ${res.error || ''}`,
            'error'
          );
          window.clearInterval(timer);
          delete pollingTimers.current[provider];
        }
      } catch (err: unknown) {
        updateProviderState(provider, {
          status: 'error',
          error: getErrorMessage(err),
          polling: false,
        });
        window.clearInterval(timer);
        delete pollingTimers.current[provider];
      }
    }, 3000);
    pollingTimers.current[provider] = timer;
  };

  const startAuth = async (provider: OAuthProvider) => {
    clearProviderTimers(provider);
    updateProviderState(provider, {
      url: undefined,
      state: undefined,
      status: 'waiting',
      polling: true,
      error: undefined,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackUrl: '',
    });
    try {
      const res = await oauthApi.startAuth(provider);
      if (!res.state) {
        const message = t('auth_login.missing_state');
        updateProviderState(provider, {
          url: res.url,
          state: undefined,
          status: 'error',
          error: message,
          polling: false,
        });
        showNotification(message, 'error');
        return;
      }
      updateProviderState(provider, {
        url: res.url,
        state: res.state,
        status: 'waiting',
        polling: true,
      });
      startPolling(provider, res.state);
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      updateProviderState(provider, { status: 'error', error: message, polling: false });
      showNotification(
        `${t(getAuthKey(provider, 'oauth_start_error'))}${message ? ` ${message}` : ''}`,
        'error'
      );
    }
  };

  const copyLink = async (url?: string) => {
    if (!url) return;
    const copied = await copyToClipboard(url);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const submitCallback = async (provider: OAuthProvider) => {
    const callbackInput = (states[provider]?.callbackUrl || '').trim();
    if (!callbackInput) {
      showNotification(
        t(
          provider === 'xai'
            ? 'auth_login.xai_callback_required'
            : 'auth_login.oauth_callback_required'
        ),
        'warning'
      );
      return;
    }
    const redirectUrl = resolveCallbackUrl(provider, callbackInput, states[provider]?.state);
    if (!redirectUrl) {
      showNotification(
        t(
          provider === 'xai' ? 'auth_login.xai_callback_state_missing' : 'auth_login.missing_state'
        ),
        'warning'
      );
      return;
    }
    updateProviderState(provider, {
      callbackSubmitting: true,
      callbackStatus: undefined,
      callbackError: undefined,
    });
    try {
      await oauthApi.submitCallback(provider, redirectUrl);
      updateProviderState(provider, { callbackSubmitting: false, callbackStatus: 'success' });
      showNotification(t('auth_login.oauth_callback_success'), 'success');
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      const message = getErrorMessage(err);
      const errorMessage =
        status === 404
          ? t('auth_login.oauth_callback_upgrade_hint', {
              defaultValue: 'Please update CLI Proxy API or check the connection.',
            })
          : message || undefined;
      updateProviderState(provider, {
        callbackSubmitting: false,
        callbackStatus: 'error',
        callbackError: errorMessage,
      });
      const notificationMessage = errorMessage
        ? `${t('auth_login.oauth_callback_error')} ${errorMessage}`
        : t('auth_login.oauth_callback_error');
      showNotification(notificationMessage, 'error');
    }
  };

  const saveOpenCodeCredential = async () => {
    const accountName = openCodeState.accountName.trim();
    const workspaceID = openCodeState.workspaceID.trim();
    const cookie = openCodeState.cookie.trim();
    const apiKey = openCodeState.apiKey.trim();
    if (!workspaceID || !cookie || openCodeState.saving) return;

    const fileName = buildOpenCodeAuthFileName(accountName, workspaceID);
    setOpenCodeState((prev) => ({
      ...prev,
      saving: true,
      status: undefined,
      error: undefined,
      savedFile: undefined,
    }));
    try {
      await authFilesApi.saveJsonObject(fileName, {
        type: 'opencode',
        email: accountName || `OpenCode ${workspaceID}`,
        workspace_id: workspaceID,
        cookie,
        ...(apiKey ? { api_key: apiKey } : {}),
        disabled: false,
      });
      setOpenCodeState((prev) => ({
        ...prev,
        saving: false,
        status: 'success',
        error: undefined,
        savedFile: fileName,
      }));
      showNotification(t('auth_login.opencode_save_success', { name: fileName }), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('common.unknown_error');
      setOpenCodeState((prev) => ({
        ...prev,
        saving: false,
        status: 'error',
        error: message,
        savedFile: undefined,
      }));
      showNotification(t('auth_login.opencode_save_error', { message }), 'error');
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('nav.oauth', { defaultValue: 'OAuth' })}</h1>

      <div className={styles.content}>
        {PROVIDERS.map((provider) => {
          const state = states[provider.id] || {};
          const canSubmitCallback = CALLBACK_SUPPORTED.includes(provider.id) && Boolean(state.url);
          const loginButtonLabel =
            state.status === 'success'
              ? t('auth_login.login_another_account')
              : t(getAuthKey(provider.id, 'oauth_button'));
          const statusBadgeClassName = [
            'status-badge',
            state.status === 'success' ? 'success' : '',
            state.status === 'error' ? 'error' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={provider.id}>
              <Card
                title={
                  <span className={styles.cardTitle}>
                    <img
                      src={getIcon(provider.icon, resolvedTheme)}
                      alt=""
                      className={styles.cardTitleIcon}
                    />
                    {t(provider.titleKey)}
                  </span>
                }
                extra={
                  <Button onClick={() => startAuth(provider.id)} loading={state.polling}>
                    {loginButtonLabel}
                  </Button>
                }
              >
                <div className={styles.cardContent}>
                  <div className={styles.cardHint}>{t(provider.hintKey)}</div>
                  {state.url && (
                    <div className={styles.authUrlBox}>
                      <div className={styles.authUrlLabel}>{t(provider.urlLabelKey)}</div>
                      <div className={styles.authUrlValue}>{state.url}</div>
                      <div className={styles.authUrlActions}>
                        <Button variant="secondary" size="sm" onClick={() => copyLink(state.url!)}>
                          {t(getAuthKey(provider.id, 'copy_link'))}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => window.open(state.url, '_blank', 'noopener,noreferrer')}
                        >
                          {t(getAuthKey(provider.id, 'open_link'))}
                        </Button>
                      </div>
                    </div>
                  )}
                  {canSubmitCallback && (
                    <div className={styles.callbackSection}>
                      <Input
                        label={t(
                          provider.id === 'xai'
                            ? 'auth_login.xai_callback_label'
                            : 'auth_login.oauth_callback_label'
                        )}
                        hint={t(
                          provider.id === 'xai'
                            ? 'auth_login.xai_callback_hint'
                            : 'auth_login.oauth_callback_hint'
                        )}
                        value={state.callbackUrl || ''}
                        onChange={(e) =>
                          updateProviderState(provider.id, {
                            callbackUrl: e.target.value,
                            callbackStatus: undefined,
                            callbackError: undefined,
                          })
                        }
                        placeholder={t(
                          provider.id === 'xai'
                            ? 'auth_login.xai_callback_placeholder'
                            : 'auth_login.oauth_callback_placeholder'
                        )}
                      />
                      <div className={styles.callbackActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => submitCallback(provider.id)}
                          loading={state.callbackSubmitting}
                        >
                          {t('auth_login.oauth_callback_button')}
                        </Button>
                      </div>
                      {state.callbackStatus === 'success' && state.status === 'waiting' && (
                        <div className="status-badge success">
                          {t('auth_login.oauth_callback_status_success')}
                        </div>
                      )}
                      {state.callbackStatus === 'error' && (
                        <div className="status-badge error">
                          {t('auth_login.oauth_callback_status_error')} {state.callbackError || ''}
                        </div>
                      )}
                    </div>
                  )}
                  {state.status && state.status !== 'idle' && (
                    <div className={statusBadgeClassName}>
                      {state.status === 'success'
                        ? t(getAuthKey(provider.id, 'oauth_status_success'))
                        : state.status === 'error'
                          ? `${t(getAuthKey(provider.id, 'oauth_status_error'))} ${state.error || ''}`
                          : t(getAuthKey(provider.id, 'oauth_status_waiting'))}
                    </div>
                  )}
                  {state.status === 'success' && (
                    <div className={styles.successActions}>
                      <Button variant="secondary" size="sm" onClick={() => navigate('/auth-files')}>
                        {t('auth_login.view_auth_files')}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          );
        })}

        <Card
          title={
            <span className={styles.cardTitle}>
              <img src={iconOpenCode} alt="" className={styles.cardTitleIcon} />
              {t('auth_login.opencode_manual_title')}
            </span>
          }
          extra={
            <Button
              onClick={() => void saveOpenCodeCredential()}
              loading={openCodeState.saving}
              disabled={
                openCodeState.saving ||
                !openCodeState.workspaceID.trim() ||
                !openCodeState.cookie.trim()
              }
            >
              {t('auth_login.opencode_save_button')}
            </Button>
          }
        >
          <div className={styles.cardContent}>
            <div className={styles.cardHint}>{t('auth_login.opencode_manual_hint')}</div>
            <div className={styles.openCodeFields}>
              <Input
                label={t('auth_login.opencode_account_label')}
                value={openCodeState.accountName}
                onChange={(event) =>
                  setOpenCodeState((prev) => ({
                    ...prev,
                    accountName: event.target.value,
                    status: undefined,
                  }))
                }
                placeholder={t('auth_login.opencode_account_placeholder')}
                disabled={openCodeState.saving}
              />
              <Input
                label={t('auth_login.opencode_workspace_label')}
                value={openCodeState.workspaceID}
                onChange={(event) =>
                  setOpenCodeState((prev) => ({
                    ...prev,
                    workspaceID: event.target.value,
                    status: undefined,
                  }))
                }
                placeholder={t('auth_login.opencode_workspace_placeholder')}
                disabled={openCodeState.saving}
                required
              />
              <Input
                label={t('auth_login.opencode_cookie_label')}
                type={showOpenCodeCookie ? 'text' : 'password'}
                value={openCodeState.cookie}
                onChange={(event) =>
                  setOpenCodeState((prev) => ({
                    ...prev,
                    cookie: event.target.value,
                    status: undefined,
                  }))
                }
                placeholder={t('auth_login.opencode_cookie_placeholder')}
                hint={t('auth_login.opencode_cookie_hint')}
                disabled={openCodeState.saving}
                required
                autoComplete="off"
                rightElement={
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowOpenCodeCookie((current) => !current)}
                    aria-label={t(
                      showOpenCodeCookie
                        ? 'auth_login.opencode_hide_secret'
                        : 'auth_login.opencode_show_secret'
                    )}
                    title={t(
                      showOpenCodeCookie
                        ? 'auth_login.opencode_hide_secret'
                        : 'auth_login.opencode_show_secret'
                    )}
                  >
                    {showOpenCodeCookie ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                }
              />
              <Input
                label={t('auth_login.opencode_api_key_label')}
                type={showOpenCodeApiKey ? 'text' : 'password'}
                value={openCodeState.apiKey}
                onChange={(event) =>
                  setOpenCodeState((prev) => ({
                    ...prev,
                    apiKey: event.target.value,
                    status: undefined,
                  }))
                }
                placeholder={t('auth_login.opencode_api_key_placeholder')}
                hint={t('auth_login.opencode_api_key_hint')}
                disabled={openCodeState.saving}
                autoComplete="off"
                rightElement={
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowOpenCodeApiKey((current) => !current)}
                    aria-label={t(
                      showOpenCodeApiKey
                        ? 'auth_login.opencode_hide_secret'
                        : 'auth_login.opencode_show_secret'
                    )}
                    title={t(
                      showOpenCodeApiKey
                        ? 'auth_login.opencode_hide_secret'
                        : 'auth_login.opencode_show_secret'
                    )}
                  >
                    {showOpenCodeApiKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </button>
                }
              />
            </div>
            {openCodeState.status === 'error' && (
              <div className="status-badge error">
                {t('auth_login.opencode_save_error', { message: openCodeState.error || '' })}
              </div>
            )}
            {openCodeState.status === 'success' && (
              <>
                <div className="status-badge success">
                  {t('auth_login.opencode_save_success', { name: openCodeState.savedFile || '' })}
                </div>
                <div className={styles.successActions}>
                  <Button variant="secondary" size="sm" onClick={() => navigate('/auth-files')}>
                    {t('auth_login.view_auth_files')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}
