# render

Work with Render.com from the command line: author and manage `render.yaml`
blueprints, SSH into running services with the host-key flags Render requires,
understand how Render hosting is laid out (services, regions, internal vs
external networking, on-box paths), and drive the REST API. Ships `render-ssh`
and `render-api` helpers. Credentials come from your environment or a secret
manager; this skill does not prescribe one.
