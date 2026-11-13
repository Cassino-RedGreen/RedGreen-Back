import hudson.security.HudsonPrivateSecurityRealm
import jenkins.model.Jenkins

def userId = System.getenv('JENKINS_ADMIN_USER')
def password = System.getenv('JENKINS_ADMIN_PASSWORD')

if (!userId?.trim() || !password) {
  throw new IllegalStateException('JENKINS_ADMIN_USER and JENKINS_ADMIN_PASSWORD must be configured.')
}

def realm = Jenkins.get().getSecurityRealm()
if (!(realm instanceof HudsonPrivateSecurityRealm)) {
  throw new IllegalStateException('Jenkins must use the configured local security realm before creating its admin user.')
}

if (realm.getUser(userId) == null) {
  realm.createAccount(userId, password)
}
