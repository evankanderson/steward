# steward

Kubernetes shared cluster provisioning for knative

The design is that this is a webserver which runs on the cluster with a
privileged service account. When a user arrives it will serve a page with Google
Login available. Once the user has logged in with Google login, it will
provision a Namespace, ResourceQuota, and RoleBinding for that user, and then
serve the user a custom KUBECONFIG file that includes the cluster information
(including server keys), namespace, and GCP auth commandline. The user should be
able to download or copy the file, set their KUBECONFIG to point to the local
file, and then start using the shared cluster in their own namespace.
