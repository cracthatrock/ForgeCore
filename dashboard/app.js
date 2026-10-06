const $ = (id) => document.getElementById(id);
const form = $('settings');
const welcomeForm = $('welcome-settings');
let csrf;
let guild;
let loading = false;
const notice = (message, error = false) => {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
};
async function api(path, data) {
  const response = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || 'Request failed.');
  }
  return result;
}
function options(name, items, selected, empty, target = form) {
  const select = target.elements.namedItem(name);
  select.replaceChildren(new Option(empty, ''));
  for (const item of items) {
    select.add(new Option(item.name, item.id));
  }
  select.value = selected || '';
}
function preview() {
  for (const [target, name] of [
    ['preview-title', 'panelTitle'],
    ['preview-description', 'panelDescription'],
    ['preview-footer', 'footer'],
    ['preview-button', 'buttonLabel'],
    ['preview-ticket-title', 'ticketTitle'],
    ['preview-ticket-message', 'ticketMessage'],
  ]) {
    $(target).textContent = form.elements.namedItem(name).value;
  }
  $('preview-panel').style.borderLeftColor = form.elements.namedItem('panelColor').value;
  $('preview-ticket').style.borderLeftColor =
    form.elements.namedItem('ticketColor').value;
}
async function loadGuild() {
  guild = $('guild').value;
  if (!guild) {
    return;
  }
  loading = true;
  $('workspace').hidden = true;
  try {
    const selected = guild;
    const data = await api(`/api/guilds/${guild}`);
    if (selected !== $('guild').value) {
      return;
    }
    $('server-name').textContent = data.name;
    const categories = data.channels.filter((c) => c.type === 4);
    const text = data.channels.filter((c) => c.type === 0);
    options('channel', text, data.welcome.channel, 'No welcome message', welcomeForm);
    options('role', data.roles, data.welcome.role, 'No join role', welcomeForm);
    for (const name of ['title', 'message', 'footer']) {
      welcomeForm.elements.namedItem(name).value = data.welcome[name];
    }
    welcomeForm.elements.namedItem('color').value =
      `#${data.welcome.color.toString(16).padStart(6, '0')}`;
    welcomeForm.elements.namedItem('mention').checked = data.welcome.mention;
    $('welcome-runtime').textContent = data.welcomeReady
      ? 'Join events connected'
      : 'Server Members Intent needed';
    welcomePreview();
    options('category', categories, data.config?.category_id, 'Choose a category');
    options('staff', data.roles, data.config?.staff_role_id, 'Choose a role');
    options('panel', text, data.config?.panel_channel_id, 'Choose a channel');
    options(
      'closedCategory',
      categories,
      data.options.closedCategory,
      'Keep in original category',
    );
    options(
      'transcriptChannel',
      text,
      data.options.transcriptChannel,
      'Private downloads only',
    );
    for (const [key, value] of Object.entries(data.options)) {
      const element = form.elements.namedItem(key);
      if (!element || ['closedCategory', 'transcriptChannel'].includes(key)) {
        continue;
      }
      if (key === 'questions') {
        element.value = value
          .map((q) => `${q.required ? 'required' : 'optional'}|${q.style}|${q.label}`)
          .join('\n');
      } else if (key.endsWith('Color')) {
        element.value = `#${value.toString(16).padStart(6, '0')}`;
      } else if (element.type === 'checkbox') {
        element.checked = value;
      } else {
        element.value = value;
      }
    }
    $('extension-list').replaceChildren();
    for (const extension of data.extensions) {
      const card = document.createElement('article');
      card.className = 'extension-card';
      const title = document.createElement('h2');
      title.textContent = extension.id;
      const description = document.createElement('p');
      description.textContent =
        {
          core: 'Essential bot commands and server administration.',
          tickets: 'Private support tickets, panels, intake forms and transcripts.',
          example: 'A simple command that shows how extensions fit together.',
          welcome: 'Custom greetings and basic join roles for new community members.',
        }[extension.id] || 'Trusted extension installed on this bot.';
      const button = document.createElement('button');
      button.textContent = extension.locked
        ? 'Always enabled'
        : extension.enabled
          ? 'Enabled · Turn off'
          : 'Disabled · Turn on';
      button.className = 'secondary';
      button.disabled = extension.locked;
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api(`/api/guilds/${guild}/extensions`, {
            id: extension.id,
            enabled: !extension.enabled,
          });
          extension.enabled = !extension.enabled;
          button.textContent = extension.enabled
            ? 'Enabled · Turn off'
            : 'Disabled · Turn on';
          notice(
            `${extension.id} ${extension.enabled ? 'enabled' : 'disabled'} for this server.`,
          );
        } catch (error) {
          notice(error.message, true);
        } finally {
          button.disabled = false;
        }
      };
      card.append(title, description, button);
      $('extension-list').append(card);
    }
    preview();
    $('workspace').hidden = false;
    $('welcome').hidden = true;
    notice('');
    $('save-status').textContent = 'Settings apply to new tickets.';
  } catch (error) {
    notice(error.message, true);
  } finally {
    loading = false;
  }
}
function payload() {
  const result = Object.fromEntries(new FormData(form));
  result.formEnabled = form.elements.namedItem('formEnabled').checked;
  return result;
}
async function save(publish) {
  if (loading || !guild) {
    return;
  }
  loading = true;
  $('save').disabled = true;
  $('publish').disabled = true;
  $('guild').disabled = true;
  try {
    await api(`/api/guilds/${guild}/${publish ? 'publish' : 'tickets'}`, payload());
    notice(
      publish
        ? 'Support panel published to Discord. Your settings are saved.'
        : 'Settings saved. New tickets will use these settings. Publish to update the public panel.',
    );
    $('save-status').textContent = 'Saved just now';
  } catch (error) {
    notice(error.message, true);
  } finally {
    loading = false;
    $('save').disabled = false;
    $('publish').disabled = false;
    $('guild').disabled = false;
  }
}
form.addEventListener('input', () => {
  preview();
  $('save-status').textContent = 'You have unsaved changes.';
});
// Validate on the server so errors in hidden steps can be displayed without browser focus errors.
form.noValidate = true;
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void save(true);
});
$('save').onclick = () => save(false);
$('guild').onchange = loadGuild;
for (const button of document.querySelectorAll('[data-step]')) {
  button.onclick = () => {
    for (const step of document.querySelectorAll('.step')) {
      step.hidden = step.id !== button.dataset.step;
    }
    for (const tab of document.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab === button);
    }
  };
}
for (const button of document.querySelectorAll('[data-tab]')) {
  button.onclick = () => {
    for (const section of ['tickets', 'extensions', 'welcome']) {
      $(section === 'welcome' ? 'welcome-module' : section).hidden =
        section !== button.dataset.tab;
    }
    for (const nav of document.querySelectorAll('.nav')) {
      nav.classList.toggle('active', nav === button);
    }
  };
}
$('logout').onclick = async () => {
  try {
    await api('/auth/logout', {});
    location.reload();
  } catch (error) {
    notice(error.message, true);
  }
};
async function init() {
  try {
    const session = await api('/api/session');
    csrf = session.csrf;
    if (!session.user) {
      if (!session.loginReady) {
        notice(
          'Dashboard is ready. Add your OAuth client secret and redirect URL to enable Discord login.',
        );
      }
      return;
    }
    $('login').hidden = true;
    $('logout').hidden = false;
    $('user').textContent = session.user.global_name || session.user.username;
    const guilds = await api('/api/guilds');
    $('guild').replaceChildren(...guilds.map((g) => new Option(g.name, g.id)));
    $('guild').disabled = false;
    if (!guilds.length) {
      notice(
        'No eligible servers found. You need Manage Server permission and ForgeCore must be installed.',
      );
      return;
    }
    await loadGuild();
  } catch (error) {
    notice(error.message, true);
  }
}
void init();

function welcomePreview() {
  const values = {
    user: '@new-member',
    username: 'new-member',
    server: $('server-name').textContent,
    count: '128',
  };
  for (const name of ['title', 'message', 'footer']) {
    $(`welcome-preview-${name}`).textContent = welcomeForm.elements
      .namedItem(name)
      .value.replace(/\{(user|username|server|count)\}/g, (_, key) => values[key]);
  }
  $('welcome-preview').style.borderLeftColor =
    welcomeForm.elements.namedItem('color').value;
}
welcomeForm.noValidate = true;
welcomeForm.addEventListener('input', () => {
  welcomePreview();
  $('welcome-save-status').textContent = 'You have unsaved changes.';
});
async function saveWelcome(test) {
  if (loading || !guild) {
    return;
  }
  loading = true;
  $('welcome-save').disabled = true;
  $('welcome-test').disabled = true;
  $('guild').disabled = true;
  try {
    const data = Object.fromEntries(new FormData(welcomeForm));
    data.mention = welcomeForm.elements.namedItem('mention').checked;
    await api(`/api/guilds/${guild}/${test ? 'welcome-test' : 'welcome'}`, data);
    notice(
      test
        ? 'Test welcome sent to your chosen channel. No role was assigned.'
        : 'Welcome settings saved. Enable the welcome extension for live joins.',
    );
    if (!test) {
      $('welcome-save-status').textContent = 'Saved just now';
    }
  } catch (error) {
    notice(error.message, true);
  } finally {
    loading = false;
    $('welcome-save').disabled = false;
    $('welcome-test').disabled = false;
    $('guild').disabled = false;
  }
}
welcomeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveWelcome(false);
});
$('welcome-test').onclick = () => saveWelcome(true);
