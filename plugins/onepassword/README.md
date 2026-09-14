# onepassword

Reliable secret retrieval from 1Password through the `op` CLI. Handles the
awkward parts: finding the right binary (native `op` or the Windows `op.exe`
under WSL), revealing concealed fields, and stripping the carriage returns and
wrapping quotes that corrupt SSH keys and other multiline secrets. Ships an
`op-secret` helper that emits a clean value to stdout or a `chmod 600` file.
