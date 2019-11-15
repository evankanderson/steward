import { OAuth2Client } from 'google-auth-library';
import k8s = require('@kubernetes/client-node');
import yaml from 'js-yaml';
import express from 'express';
import path from 'path';
import fs from 'fs';

// Configuration read from environment variables
const CLIENT_ID = process.env.CLIENT_ID || '';
const MASTER_ADDRESS = process.env.MASTER_ADDRESS || 'unknown';
const PORT = process.env.PORT || 8080;

const app = express();
app.set('views', path.join(process.cwd(), 'static'));
app.set('view engine', 'ejs');
const client = new OAuth2Client(CLIENT_ID);
const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sCore = kc.makeApiClient(k8s.CoreV1Api);
const k8sRbac = kc.makeApiClient(k8s.RbacAuthorizationV1Api);

/**
 * Returns the userId, or <nil> if login was unsuccessful.
 *
 * @param userToken The user's JWT.
 */
async function verify(userToken: string | undefined): Promise<string | null> {
  try {
    console.log(`User token: ${userToken}`);
    const ticket = await client.verifyIdToken({
      idToken: userToken || '',
      audience: `${CLIENT_ID}.apps.googleusercontent.com`,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      return null;
    }
    return payload['email'] || null;
  } catch (e) {
    console.log('Failed to validate JWT: ' + e);
    return null;
  }
}

function getCertData(cluster: any): string | undefined {
  let certData = cluster.caData;
  if (!certData && cluster.caFile) {
    certData = fs.readFileSync(cluster.caFile).toString('base64');
  }
  return certData;
}

app.get('/', (req, res) => {
  res.render('main', { CLIENT_ID: CLIENT_ID });
});
app.get('/wheel.jpg', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'static', 'wheel.jpg'));
});
app.post('/signin', async (req, res) => {
  let user = await verify(req.get('Authorization'));
  if (!user) {
    res.send(JSON.stringify({ message: "Sorry, we couldn't identify you." }));
    return;
  }

  let k8sname = user.split('@')[0].replace(/[^a-z0-9]/g, '');
  // Provision a namespace, set quota and grant RBAC RoleBinding
  try {
    let ns = await k8sCore.readNamespace(k8sname);
  } catch (e) {
    try {
      let ns = await k8sCore.createNamespace({
        metadata: {
          name: `${k8sname}`,
          labels: { 'knative-eventing-injection': 'enabled' },
        },
      });
    } catch (e) {
      res.send(
        JSON.stringify({
          message: `Sorry, failed to create namespace ${k8sname}: ${e.message}`,
        })
      );
      return;
    }
  }
  try {
    let role = await k8sRbac.listNamespacedRoleBinding(k8sname);
    if (role.body.items.length > 0) {
      let hasRole = role.body.items.some(binding => {
        if (binding.subjects) {
          return binding.subjects.some(subject => {
            return subject.kind == 'User' && subject.name == user;
          });
        }
        return false;
      });
      if (!hasRole) {
        return res.send(
          JSON.stringify({
            message: `Sorry, the namespace ${k8sname} is owned by another user.`,
          })
        );
      }
    } else {
      let rq = k8sCore.createNamespacedResourceQuota(k8sname, {
        metadata: { name: 'default-quota' },
        spec: { hard: { cpu: '3', memory: '6Gi' } },
      });
      let role = k8sRbac.createNamespacedRoleBinding(k8sname, {
        metadata: { name: 'knative-user' },
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: 'workshop-user',
        },
        subjects: [{ kind: 'User', name: user }],
      });
      let ranger = k8sCore.createNamespacedLimitRange(k8sname, {
        metadata: { name: 'defaults' },
        spec: {
          limits: [
            {
              _default: { cpu: '1000m', memory: '700Mi' },
              defaultRequest: { cpu: '300m', memory: '500Mi' },
              type: 'Container',
            },
          ],
        },
      });
      let eventView = k8sRbac.createNamespacedRoleBinding(k8sname, {
        metadata: { name: 'event-viewer' },
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: 'event-viewer',
        },
        subjects: [{ kind: 'ServiceAccount', name: 'default' }],
      });
      await Promise.all([rq, role, ranger, eventView]);
    }

    let certData = getCertData(kc.clusters[0]);
    if (!certData) {
      return res.send(
        JSON.stringify({
          message: `Could not find CA info in ${yaml.safeDump(kc.clusters[0])}`,
        })
      );
    }

    let clusterYaml = yaml.safeDump({
      apiVersion: 'v1',
      kind: 'Config',
      clusters: [
        {
          cluster: {
            // Fold at 64 characters so it is readable.
            'certificate-authority-data': certData.replace(/.{1,64}/g, '$&\n'),
            server: MASTER_ADDRESS,
          },
          name: 'workshop',
        },
      ],
      users: [
        {
          name: 'gcloud',
          user: {
            'auth-provider': {
              config: {
                'cmd-args': 'config config-helper --format=json',
                'cmd-path': 'gcloud',
                'expiry-key': '{.credential.token_expiry}',
                'token-key': '{.credential.access_token}',
              },
              name: 'gcp',
            },
          },
        },
      ],
      contexts: [
        {
          name: 'workshop',
          context: { cluster: 'workshop', user: 'gcloud', namespace: k8sname },
        },
      ],
      'current-context': 'workshop',
    });

    res.send(
      JSON.stringify({
        message: `Hello ${user}`,
        namespace: k8sname,
        config: clusterYaml,
      })
    );
  } catch (e) {
    res.send(
      JSON.stringify({
        message: `Sorry, failed to initialize namespace ${k8sname}: ${e.response.body.message}`,
      })
    );
  }
  return;
});

if (!CLIENT_ID) {
  console.log('You must set $CLIENT_ID or the application will not work.');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
  console.log(`Using clusters ${JSON.stringify(kc.clusters, null, 2)}`);
});
