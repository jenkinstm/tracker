# Доступ к серверу для Claude Code

Ubuntu 24.04 LTS, чистая установка. Инструкция выполняется один раз, вручную.

## Как это устроено

Claude Code сам никуда не подключается — он запускается на твоей машине и выполняет
команды в твоей оболочке, в том числе `ssh`. «Дать доступ» означает: настроить сервер,
положить ключ, завести алиас в `~/.ssh/config` и разрешить агенту вызывать `ssh`.

Два пользователя на сервере:

| Пользователь | Кто пользуется | Права |
|---|---|---|
| `kosm` | ты лично | sudo, полное администрирование |
| `deploy` | Claude Code и CI | без sudo, только группа `docker` |

Разделение существует ради одного: чтобы агент не мог поставить пакет, поменять
sshd или отредактировать firewall. Оговорка ниже в разделе «Границы» — про то,
насколько это ограничение настоящее.

---

## Шаг 1. Первый вход и базовое обновление

С провайдера обычно приходит root и пароль или ключ.

```bash
ssh root@<IP>

apt update && apt full-upgrade -y
timedatectl set-timezone Europe/Amsterdam
hostnamectl set-hostname fit
```

## Шаг 2. Пользователи

```bash
# твой рабочий пользователь
adduser kosm
usermod -aG sudo kosm

# пользователь для агента и CI, без пароля и без sudo
adduser --disabled-password --gecos "" deploy
```

## Шаг 3. Ключи

**На локальной машине** (там, где запускается Claude Code) — два отдельных ключа.
Отдельный ключ для агента нужен, чтобы его можно было отозвать, не трогая свой.

```bash
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/fit_admin  -C "kosm@fit"
ssh-keygen -t ed25519 -a 100 -f ~/.ssh/fit_deploy -C "claude-code@fit"
```

Пароль на ключ ставь — с `ssh-agent` вводить его придётся раз за сессию, а украденный
файл ключа без пароля бесполезен.

Копируем на сервер:

```bash
ssh-copy-id -i ~/.ssh/fit_admin.pub  root@<IP>   # временно, потом перевесим
ssh-copy-id -i ~/.ssh/fit_deploy.pub root@<IP>
```

`ssh-copy-id` кладёт ключ root'у, поэтому переносим руками **на сервере**:

```bash
install -d -m 700 -o kosm   -g kosm   /home/kosm/.ssh
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh

# из /root/.ssh/authorized_keys возьми нужную строку целиком (одна строка = один ключ)
nano /home/kosm/.ssh/authorized_keys      # сюда ключ fit_admin
nano /home/deploy/.ssh/authorized_keys    # сюда ключ fit_deploy

chmod 600 /home/kosm/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
chown kosm:kosm     /home/kosm/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

**Проверь вход новым пользователем в отдельном окне терминала, не закрывая текущее.**
Если что-то сломается на следующем шаге, root-сессия останется единственным входом.

```bash
ssh -i ~/.ssh/fit_admin kosm@<IP>
```

## Шаг 4. Ужесточение SSH

Имя файла важно: конфиги из `sshd_config.d` читаются по алфавиту, и **побеждает первое
встреченное значение**. В облачных образах лежит `50-cloud-init.conf` с
`PasswordAuthentication yes` — файл с префиксом `99` его не переспорит.

```bash
cat > /etc/ssh/sshd_config.d/01-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
X11Forwarding no
AllowTcpForwarding no
MaxAuthTries 3
AllowUsers kosm deploy
EOF

sshd -t && systemctl restart ssh
sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|allowusers'
```

Последняя команда должна показать `permitrootlogin no` и `passwordauthentication no`.
Если показывает `yes` — значит выигрывает cloud-init, переименуй файл в `00-hardening.conf`.

В 24.04 sshd активируется через сокет (`ssh.socket`). На эти настройки это не влияет,
но если когда-нибудь захочешь сменить порт — менять придётся именно юнит сокета,
а не `sshd_config`.

## Шаг 5. Firewall, fail2ban, автообновления

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

apt install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled  = true
backend  = systemd
maxretry = 3
findtime = 10m
bantime  = 1h
EOF
systemctl enable --now fail2ban

apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

`backend = systemd` обязателен: в 24.04 из минимального образа нет `/var/log/auth.log`,
логи живут в journald, и дефолтный бэкенд молча не находит ничего.

> **Про ufw и Docker.** Docker пишет правила напрямую в iptables и обходит ufw.
> Порт, опубликованный через `ports:` в compose, будет доступен из интернета,
> даже если ufw его не открывал. Поэтому наружу публикует порты **только Caddy**,
> а postgres описывается через `expose:`, без `ports:`. Иначе база окажется в интернете.

## Шаг 6. Swap

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
sysctl --system
free -h
```

## Шаг 7. Docker

```bash
apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

usermod -aG docker deploy
usermod -aG docker kosm
```

## Шаг 8. Каталог проекта

```bash
install -d -o deploy -g deploy /srv/fit
install -d -o deploy -g deploy /srv/fit/backups
```

Здесь будут жить `docker-compose.yml`, `Caddyfile` и `.env`. **`.env` создаёшь ты
руками после первого деплоя**, права `600`, владелец `deploy`.

## Шаг 9. Алиас на локальной машине

```bash
cat >> ~/.ssh/config <<'EOF'

Host fit
    HostName 203.0.113.10
    User deploy
    IdentityFile ~/.ssh/fit_deploy
    IdentitiesOnly yes
    ForwardAgent no
    ServerAliveInterval 30

Host fit-admin
    HostName 203.0.113.10
    User kosm
    IdentityFile ~/.ssh/fit_admin
    IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
```

Подставь реальный IP. Теперь `ssh fit` — это агентский доступ, `ssh fit-admin` — твой.
`ForwardAgent no` важен: пробрасывать свой ssh-агент на сервер не нужно, иначе
скомпрометированный сервер получит твои ключи.

Проверка:

```bash
ssh fit 'whoami && docker ps && free -h && df -h /'
```

## Шаг 10. Права в Claude Code

В корне проекта, файл `.claude/settings.local.json` (личный, в git не коммитится):

```json
{
  "permissions": {
    "allow": [
      "Bash(ssh fit *)",
      "Bash(scp * fit:*)",
      "Bash(rsync * fit:*)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Bash(ssh fit-admin *)"
    ]
  }
}
```

Что здесь происходит:

- `Bash(ssh fit *)` — агент выполняет команды на сервере от `deploy` без подтверждения.
- `Bash(ssh fit-admin *)` в `deny` — под твоего пользователя с sudo агент не ходит.
  Правило запретительное, а `deny` всегда сильнее `allow`, так что переопределить его
  случайным «Yes, don't ask again» не получится.
- Запрет на чтение `.env` — от попадания секретов в контекст.

Текущий набор правил всегда виден по команде `/permissions`.
Документация: https://code.claude.com/docs/en/permissions

Добавь в `.gitignore`:

```
.claude/settings.local.json
```

---

## Границы: что ты на самом деле отдаёшь

Стоит понимать честно, а не успокаивать себя настройками.

**`Bash(ssh fit *)` — это разрешение выполнить на сервере что угодно от `deploy`.**
Попытки сузить его шаблонами вроде `deny: Bash(ssh fit sudo *)` не работают:
официальная документация прямо предупреждает, что правила, ограничивающие аргументы
команд, обходятся вариациями записи. Настоящая граница — это отсутствие sudo
у пользователя `deploy`, и держится она средствами Linux, а не Claude Code.

**Группа `docker` эквивалентна root.** Кто может запускать контейнеры, тот может
примонтировать `/` внутрь контейнера и получить полный доступ к системе. Это
не дыра в конфигурации, это устройство Docker. Так что `deploy` — не «ограниченный
пользователь», а «root, который не умеет apt». Для личного проекта это приемлемо,
но пусть решение будет осознанным.

**Что действительно защищено:**

- твой личный ключ и sudo-пользователь — агент под ними не работает;
- содержимое `.env` — не читается в контекст (файл лежит на сервере, не в репозитории);
- вход по паролю выключен, root по SSH закрыт — внешние переборы бессмысленны.

**Если нужна жёсткая граница** — вместо доступа к оболочке дай агенту forced command.
В `/home/deploy/.ssh/authorized_keys` перед ключом:

```
command="/usr/local/bin/deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding ssh-ed25519 AAAA...
```

Тогда любая попытка `ssh fit <что угодно>` выполнит только твой скрипт, а его
содержимое пишешь ты. Агент сможет деплоить и смотреть логи — и ничего больше.
Это правильный вариант для боевого сервера с чужими данными; для личного трекера,
скорее всего, избыточен.

---

## Чек-лист после настройки

- [ ] `ssh root@<IP>` — отказ в доступе
- [ ] вход по паролю невозможен: `ssh -o PubkeyAuthentication=no kosm@<IP>` — отказ
- [ ] `ssh fit whoami` → `deploy`
- [ ] `ssh fit docker ps` работает без sudo
- [ ] `ssh fit sudo -n true` → отказ (sudo у `deploy` нет)
- [ ] `ufw status` → активен, открыты 22, 80, 443
- [ ] `free -h` → swap 2 ГБ подключён
- [ ] `fail2ban-client status sshd` → jail работает
- [ ] DNS: `dig +short fit.profkosm.ru` → IP сервера
- [ ] в проекте есть `.claude/settings.local.json`, и он в `.gitignore`
