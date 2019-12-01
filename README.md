# Steward

Kubernetes shared cluster provisioning for knative

The design is that this is a webserver which runs on the cluster with a
privileged service account. When a user arrives it will serve a page with Google
Login available. Once the user has logged in with Google login, it will
provision a Namespace, ResourceQuota, LimitRanger, Broker and RoleBindings for
that user, and then serve the user a custom KUBECONFIG file that includes the
cluster information (including server keys), namespace, and GCP auth
commandline. The user


## Setup

... this is longer than I'd like, but should allow for complete demos of Knative
on a shared cluster where the participants can just walk up and sign in with
Google and then get started with `kn` commands.

On the cluster administrator side, you'll need to set up a Kubernetes cluster
which support the Google auth (I've only tested GKE, not sure what's required to
get the OAuth to work elsewhere), and then do the following:

1. Have a domain that you can use for serving both the user applications and the
   provisioning application. You'll need to be able to set some DNS records on
   that domain later. In this description, we use `kube.demo.app` as the domain.

1. Create a Google Project via http://console.cloud.google.com/ and create an
   OAuth2 Client ID here:
   https://console.cloud.google.com/apis/credentials?project=kubecon-knative-2019

   Follow the instructions for [web
   signin](https://developers.google.com/identity/sign-in/web/sign-in) and
   [backend
   signin](https://developers.google.com/identity/sign-in/web/backend-auth) for
   setting up the authorization credentials. In particular, you'll

1. Install Istio: https://knative.dev/docs/install/installing-istio/

1. Install the serving operator: https://github.com/knative/serving-operator

   ```shell
   kubectl apply -f https://github.com/knative/serving-operator/releases/download/v0.10.0/serving-operator.yaml
   ```

1. Install eventing and monitoring (not using the operator):
   https://knative.dev/docs/install/knative-with-any-k8s/#installing-knative

   ```shell
   kubectl apply --selector knative.dev/crd-install=true \
   --filename https://github.com/knative/eventing/releases/download/v0.10.0/release.yaml \
   --filename https://github.com/knative/serving/releases/download/v0.10.0/monitoring.yaml
   ```

   And reapply if needed due to CRD races.

1. Configure a wildcard domain (`*.kube.demo.app IN A $CLUSTER_IP`) pointing at
   your Istio `istio-ingressgateway` in the `istio-system` namespace.

1. Patch the `config-domain` ConfigMap with the new DNS address. Note that the
   serving operator may reset the `config-domain`, so you'll want to keep this
   command handy. Symptoms of the reset are that all KServices stop working at
   once, and this command reports "patched" rather than "patched (no change)".

   ```shell
   kubectl patch configmap config-domain -n knative-serving --patch "{\"data\": {\"example.com\": null, \"kube.majordemo.com\": \"\"}}"
   ```

   (The terrible quoting allows the command to work from `cmd.exe` in a pinch.)

1. Create the following ClusterRoles needed for Steward and the created
   resources:

   ```yaml
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRole
   metadata:
     name: provision
   rules:
     - apiGroups:
         - ''
       resources:
         - namespaces
         - resourcequotas
         - limitranges
       verbs:
         - '*'
     - apiGroups:
         - rbac.authorization.k8s.io
       resources:
         - rolebindings
       verbs:
         - '*'
     - apiGroups:
         - rbac.authorization.k8s.io
       resourceNames:
         - workshop-user
	 - event-viewer
       resources:
         - clusterroles
       verbs:
         - bind
   ---
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRole
   metadata:
     name: workshop-user
   rules:
     - apiGroups:
         - serving.knative.dev
       resources:
         - services
       verbs:
         - '*'
     - apiGroups:
         - serving.knative.dev
       resources:
         - '*'
       verbs:
         - get
         - list
         - watch
     - apiGroups:
         - ''
       resources:
         - configmaps
       verbs:
         - '*'
     - apiGroups:
         - ''
       resources:
         - namespaces
       verbs:
         - get
         - list
         - watch
     - apiGroups:
         - ''
       resources:
         - pods
         - pods/list
       verbs:
         - get
         - list
         - watch
         - delete
     - apiGroups:
         - eventing.knative.dev
       resources:
         - triggers
       verbs:
         - '*'
     - apiGroups:
         - sources.eventing.knative.dev
       resources:
         - apiserversources
       verbs:
         - '*'
   ---
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRole
   metadata:
     name: event-viewer
   rules:
     - apiGroups:
         - ''
       resources:
         - events
       verbs:
         - get
         - watch
         - list
   ```

1. Create the following ClusterRoleBinding for launching Steward as the
   `provision` service in namespace default with the default service account:

   ```yaml
   apiVersion: rbac.authorization.k8s.io/v1
   kind: ClusterRoleBinding
   metadata:
     name: provisioner
   roleRef:
     apiGroup: rbac.authorization.k8s.io
     kind: ClusterRole
     name: provision
   subjects:
     - kind: ServiceAccount
       name: default
       namespace: default
   ```

1. Build the steward application into an image. I use `gcloud build` like so:

   ```shell
   gcloud builds submit --project $PROJECT_ID --tag gcr.io/$PROJECT_ID/steward:live-$COUNTER
   ```

1. Deploy the Steward application in the default namespace of the cluster. Note
   that you'll need the client ID (the part before
   `.apps.googleusercontent.com`) from step 2 and to know the address of your
   Kubernetes master.

   ```shell
   kn service create provision --image gcr.io/$PROJECT_ID/steward:live-$COUNTER --env CLIENT_ID=$CLIENT_ID --env MASTER_ADDRESS=https://1.2.3.4
   ```

1. If you want to expose Grafana and Kibana from the cluster as well, you'll
   need to add a VirtualService like the following:

   ```yaml
   apiVersion: networking.istio.io/v1alpha3
   kind: VirtualService
   metadata:
     name: show-grafana
     namespace: default
   spec:
     # This is the gateway shared in knative service mesh.
     gateways:
       - knative-ingress-gateway.knative-serving.svc.cluster.local
     # Set host to the domain name that you own.
     hosts:
       - dashboard.kube.majordemo.com
     http:
       - match:
           - uri:
               exact: '/logging'
         rewrite:
           uri: '/'
         route:
           - destination:
               host: kibana-logging.knative-monitoring.svc.cluster.local
               port:
                 number: 5601
       - match:
           - uri:
               prefix: '/logging/'
         rewrite:
           # Rewrite the URI header to remove the prefix for Kibana. See
           # https://stackoverflow.com/questions/36266776/kibana-server-basepath-results-in-404
           # for details.
           uri: '/'
         route:
           - destination:
               host: kibana-logging.knative-monitoring.svc.cluster.local
               port:
               number: 5601
       - match:
           - uri:
               prefix: '/'
         route:
           - destination:
               host: grafana.knative-monitoring.svc.cluster.local
               port:
                 number: 30802
   ```

   Note that you'll also need to update the default Kibana installation to
   change the `SERVER_BASEPATH` environment variable in the Deployment to
   `/logging` (no trailing "/").

## End result

You should now be able to walk through the
[steps in this tutorial](https://docs.google.com/presentation/d/1LRV7AmZa1a2ddkNlyjdyr9dGe2s6GNhXI2woA2ELr6c/edit).
