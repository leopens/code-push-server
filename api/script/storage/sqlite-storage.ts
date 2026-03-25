// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import * as q from "q";
import * as stream from "stream";
import * as storage from "./storage";
import * as shortid from "shortid";
const Database = require("better-sqlite3");

import Promise = q.Promise;

export class SqliteStorage implements storage.Storage {
  private _db: any;
  private _blobDir: string;

  constructor(dbPath?: string) {
    if (!dbPath) {
      dbPath = "codepush.sqlite";
    }

    this._blobDir = path.resolve(process.env.SQLITE_BLOB_DIR || "./sqlite-blobs");
    if (!fs.existsSync(this._blobDir)) {
      fs.mkdirSync(this._blobDir, { recursive: true });
    }

    this._db = new Database(path.resolve(dbPath));
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("synchronous = NORMAL");
    this._db.pragma("busy_timeout = 5000");
    this._db.pragma("foreign_keys = ON");

    this.createSchema();
  }

  public checkHealth(): Promise<void> {
    return q<void>(null);
  }

  public addAccount(account: storage.Account): Promise<string> {
    account = storage.clone(account);
    account.id = shortid.generate();

    const stmt = this._db.prepare(
      `INSERT INTO accounts (id, email, name, createdTime, azureAdId, gitHubId, microsoftId) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    try {
      stmt.run(account.id, account.email, account.name, account.createdTime, account.azureAdId, account.gitHubId, account.microsoftId);
      return q(account.id);
    } catch (error: any) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return q.reject(storage.storageError(storage.ErrorCode.AlreadyExists, "Account already exists"));
      }
      return q.reject(storage.storageError(storage.ErrorCode.Other, error.message));
    }
  }

  public getAccount(accountId: string): Promise<storage.Account> {
    const stmt = this._db.prepare("SELECT * FROM accounts WHERE id = ?");
    const row = stmt.get(accountId);
    if (!row) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "Account not found"));
    }

    const account: storage.Account = {
      id: row.id,
      email: row.email,
      name: row.name,
      createdTime: row.createdTime,
      azureAdId: row.azureAdId,
      gitHubId: row.gitHubId,
      microsoftId: row.microsoftId,
    };

    return q(storage.clone(account));
  }

  public getAccountByEmail(email: string): Promise<storage.Account> {
    const stmt = this._db.prepare("SELECT * FROM accounts WHERE LOWER(email) = LOWER(?)");
    const row = stmt.get(email);

    if (!row) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "Account not found"));
    }

    const account: storage.Account = {
      id: row.id,
      email: row.email,
      name: row.name,
      createdTime: row.createdTime,
      azureAdId: row.azureAdId,
      gitHubId: row.gitHubId,
      microsoftId: row.microsoftId,
    };

    return q(storage.clone(account));
  }

  public updateAccount(email: string, updates: storage.Account): Promise<void> {
    if (!email) {
      throw new Error("No account email");
    }

    return this.getAccountByEmail(email).then((account: storage.Account) => {
      const merged = Object.assign({}, account, updates);
      this._db.prepare(
        `UPDATE accounts SET email=?, name=?, createdTime=?, azureAdId=?, gitHubId=?, microsoftId=? WHERE id=?`
      ).run(
        merged.email,
        merged.name,
        merged.createdTime,
        merged.azureAdId,
        merged.gitHubId,
        merged.microsoftId,
        account.id
      );
      return q(<void>null);
    });
  }

  public getAccountIdFromAccessKey(accessKey: string): Promise<string> {
    const stmt = this._db.prepare("SELECT accountId, expires FROM accessKeys WHERE name = ?");
    const row = stmt.get(accessKey);

    if (!row) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "Access key not found"));
    }

    if (new Date().getTime() >= row.expires) {
      return q.reject(storage.storageError(storage.ErrorCode.Expired, "The access key has expired."));
    }

    return q(row.accountId);
  }

  public addApp(accountId: string, app: storage.App): Promise<storage.App> {
    app = storage.clone(app);
    const account = this._db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
    if (!account) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "Account not found"));
    }

    app.id = shortid.generate();
    const collabMap: storage.CollaboratorMap = {};
    collabMap[account.email] = { accountId, permission: storage.Permissions.Owner };
    app.collaborators = collabMap;

    const insertApp = this._db.prepare("INSERT INTO apps (id, name, createdTime) VALUES (?, ?, ?)");
    const insertCollaborator = this._db.prepare("INSERT INTO app_collaborators (appId, accountId, permission) VALUES (?, ?, ?)");

    const tx = this._db.transaction(() => {
      insertApp.run(app.id, app.name, app.createdTime);
      insertCollaborator.run(app.id, accountId, storage.Permissions.Owner);
    });
    tx();

    return q(storage.clone(app));
  }

  public getApps(accountId: string): Promise<storage.App[]> {
    const stmt = this._db.prepare(
      "SELECT a.id, a.name, a.createdTime FROM apps a JOIN app_collaborators c ON a.id = c.appId WHERE c.accountId = ?"
    );
    const rows = stmt.all(accountId);
    const apps: storage.App[] = rows.map((row: any) => {
      const collaborators = this.getCollaboratorsMap(row.id);
      return <storage.App>{
        id: row.id,
        name: row.name,
        createdTime: row.createdTime,
        collaborators,
      };
    });

    apps.forEach((app: storage.App) => {
      this.addIsCurrentAccountProperty(app, accountId);
    });

    return q(storage.clone(apps));
  }

  public getApp(accountId: string, appId: string): Promise<storage.App> {
    const appRow = this._db.prepare("SELECT id, name, createdTime FROM apps WHERE id = ?").get(appId);
    if (!appRow) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "App not found"));
    }

    const collaborators = this.getCollaboratorsMap(appId);
    if (!collaborators || !collaborators[Object.keys(collaborators)[0]]) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "App collaborators not found"));
    }

    if (!collaborators || !Object.keys(collaborators).length) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "App not found"));
    }

    if (!collaborators || !this.isCollaboratorByAccountId(collaborators, accountId)) {
      // Still return app if requestor does not have relationship? follow existing logic maybe returns 404.
      // In this storage layer, we maintain access with caller id, so if requested and account has no relation, fail.
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "App not found"));
    }

    const app: storage.App = {
      id: appRow.id,
      name: appRow.name,
      createdTime: appRow.createdTime,
      collaborators,
    };

    this.addIsCurrentAccountProperty(app, accountId);
    return q(storage.clone(app));
  }

  public removeApp(accountId: string, appId: string): Promise<void> {
    const appRow = this._db.prepare("SELECT id FROM apps WHERE id = ?").get(appId);
    if (!appRow) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "App not found"));
    }

    const isOwner = this._db
      .prepare("SELECT 1 FROM app_collaborators WHERE appId = ? AND accountId = ? AND permission = ?")
      .get(appId, accountId, storage.Permissions.Owner);
    if (!isOwner) {
      return q.reject(new Error("Wrong accountId"));
    }

    const tx = this._db.transaction(() => {
      const deploymentIds = this._db.prepare("SELECT id FROM deployments WHERE appId = ?").all(appId).map((r: any) => r.id);
      for (const deploymentId of deploymentIds) {
        this._db.prepare("DELETE FROM packages WHERE deploymentId = ?").run(deploymentId);
      }
      this._db.prepare("DELETE FROM deployments WHERE appId = ?").run(appId);
      this._db.prepare("DELETE FROM app_collaborators WHERE appId = ?").run(appId);
      this._db.prepare("DELETE FROM apps WHERE id = ?").run(appId);
    });
    tx();

    return q(<void>null);
  }

  public updateApp(accountId: string, app: storage.App): Promise<void> {
    app = storage.clone(app);
    if (!this._db.prepare("SELECT 1 FROM apps WHERE id = ?").get(app.id)) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "App not found"));
    }

    this.removeIsCurrentAccountProperty(app);

    this._db
      .prepare("UPDATE apps SET name = ?, createdTime = ? WHERE id = ?")
      .run(app.name, app.createdTime, app.id);

    if (app.collaborators) {
      const existingCollabSql = this._db.prepare("SELECT accountId FROM app_collaborators WHERE appId = ?");
      const existingCollabs = existingCollabSql.all(app.id).map((r: any) => r.accountId);
      for (const email of Object.keys(app.collaborators)) {
        const collaborator = app.collaborators[email];
        if (existingCollabs.indexOf(collaborator.accountId) === -1) {
          this._db
            .prepare("INSERT INTO app_collaborators (appId, accountId, permission) VALUES (?, ?, ?)")
            .run(app.id, collaborator.accountId, collaborator.permission);
        } else {
          this._db
            .prepare("UPDATE app_collaborators SET permission = ? WHERE appId = ? AND accountId = ?")
            .run(collaborator.permission, app.id, collaborator.accountId);
        }
      }
    }

    return q(<void>null);
  }

  public transferApp(accountId: string, appId: string, email: string): Promise<void> {
    if (storage.isPrototypePollutionKey(email)) {
      return q.reject(storage.storageError(storage.ErrorCode.Invalid, "Invalid email parameter"));
    }

    let app: storage.App;
    let targetAccount: storage.Account;

    return this.getApp(accountId, appId)
      .then((appObj: storage.App) => {
        app = appObj;
        return this.getAccountByEmail(email);
      })
      .then((account: storage.Account) => {
        targetAccount = account;
        email = targetAccount.email;

        if (this.isOwner(app.collaborators || {}, email)) {
          return q.reject(storage.storageError(storage.ErrorCode.AlreadyExists, "The given account already owns the app."));
        }

        const ownerEmail = Object.keys(app.collaborators || {}).find(
          (key: string) => app.collaborators[key].permission === storage.Permissions.Owner
        );

        if (ownerEmail) {
          this._db
            .prepare("UPDATE app_collaborators SET permission = ? WHERE appId = ? AND accountId = ?")
            .run(storage.Permissions.Collaborator, appId, app.collaborators[ownerEmail].accountId);
        }

        const targetCollaboratorRow = this._db
          .prepare("SELECT 1 FROM app_collaborators WHERE appId = ? AND accountId = ?")
          .get(appId, targetAccount.id);

        if (targetCollaboratorRow) {
          this._db
            .prepare("UPDATE app_collaborators SET permission = ? WHERE appId = ? AND accountId = ?")
            .run(storage.Permissions.Owner, appId, targetAccount.id);
        } else {
          this._db
            .prepare("INSERT INTO app_collaborators (appId, accountId, permission) VALUES (?, ?, ?)")
            .run(appId, targetAccount.id, storage.Permissions.Owner);
        }

        return q(<void>null);
      });
  }

  public addCollaborator(accountId: string, appId: string, email: string): Promise<void> {
    if (storage.isPrototypePollutionKey(email)) {
      return q.reject(storage.storageError(storage.ErrorCode.Invalid, "Invalid email parameter"));
    }

    return this.getApp(accountId, appId).then((app: storage.App) => {
      if (this.isCollaborator(app.collaborators, email) || this.isOwner(app.collaborators, email)) {
        return q.reject(storage.storageError(storage.ErrorCode.AlreadyExists));
      }

      const target = this._db.prepare("SELECT * FROM accounts WHERE LOWER(email) = LOWER(?)").get(email);
      if (!target) {
        return q.reject(storage.storageError(storage.ErrorCode.NotFound, "The specified e-mail address doesn't represent a registered user"));
      }

      email = target.email;

      this._db
        .prepare("INSERT INTO app_collaborators (appId, accountId, permission) VALUES (?, ?, ?)")
        .run(appId, target.id, storage.Permissions.Collaborator);

      return q(<void>null);
    });
  }

  public getCollaborators(accountId: string, appId: string): Promise<storage.CollaboratorMap> {
    return this.getApp(accountId, appId).then((app: storage.App) => {
      return q<storage.CollaboratorMap>(app.collaborators);
    });
  }

  public removeCollaborator(accountId: string, appId: string, email: string): Promise<void> {
    return this.getApp(accountId, appId).then((app: storage.App) => {
      if (this.isOwner(app.collaborators, email)) {
        return q.reject(storage.storageError(storage.ErrorCode.AlreadyExists));
      }

      const target = this._db.prepare("SELECT * FROM accounts WHERE LOWER(email) = LOWER(?)").get(email);
      if (!target || !this.isCollaborator(app.collaborators, email)) {
        return q.reject(storage.storageError(storage.ErrorCode.NotFound));
      }

      this._db
        .prepare("DELETE FROM app_collaborators WHERE appId = ? AND accountId = ?")
        .run(appId, target.id);

      return q(<void>null);
    });
  }

  public addDeployment(accountId: string, appId: string, deployment: storage.Deployment): Promise<string> {
    deployment = storage.clone(deployment);

    const appRow = this._db.prepare("SELECT id FROM apps WHERE id = ?").get(appId);
    if (!appRow || !this._db.prepare("SELECT id FROM accounts WHERE id = ?").get(accountId)) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    deployment.id = shortid.generate();
    this._db
      .prepare("INSERT INTO deployments (id, appId, name, key, createdTime) VALUES (?, ?, ?, ?, ?)")
      .run(deployment.id, appId, deployment.name, deployment.key, deployment.createdTime);

    return q(deployment.id);
  }

  public getDeploymentInfo(deploymentKey: string): Promise<storage.DeploymentInfo> {
    const row = this._db.prepare("SELECT id, appId FROM deployments WHERE key = ?").get(deploymentKey);
    if (!row) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    return q({ appId: row.appId, deploymentId: row.id });
  }

  public getDeployment(accountId: string, appId: string, deploymentId: string): Promise<storage.Deployment> {
    const row = this._db
      .prepare("SELECT id, name, key, createdTime FROM deployments WHERE id = ? AND appId = ?")
      .get(deploymentId, appId);

    if (!row) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    return q(<storage.Deployment>{
      id: row.id,
      name: row.name,
      key: row.key,
      createdTime: row.createdTime,
    });
  }

  public getDeployments(accountId: string, appId: string): Promise<storage.Deployment[]> {
    const deployments = this._db.prepare("SELECT id, name, key, createdTime FROM deployments WHERE appId = ?").all(appId);
    return q(storage.clone(deployments));
  }

  public removeDeployment(accountId: string, appId: string, deploymentId: string): Promise<void> {
    const deployment = this._db.prepare("SELECT * FROM deployments WHERE id = ? AND appId = ?").get(deploymentId, appId);
    if (!deployment) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    this._db.prepare("DELETE FROM packages WHERE deploymentId = ?").run(deploymentId);
    this._db.prepare("DELETE FROM deployments WHERE id = ?").run(deploymentId);

    return q(<void>null);
  }

  public updateDeployment(accountId: string, appId: string, deployment: storage.Deployment): Promise<void> {
    if (!deployment.id) {
      throw new Error("No deployment id");
    }

    const existing = this._db.prepare("SELECT id FROM deployments WHERE id = ? AND appId = ?").get(deployment.id, appId);
    if (!existing) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    this._db
      .prepare("UPDATE deployments SET name = ?, key = ? WHERE id = ?")
      .run(deployment.name, deployment.key, deployment.id);

    return q(<void>null);
  }

  public commitPackage(
    accountId: string,
    appId: string,
    deploymentId: string,
    appPackage: storage.Package
  ): Promise<storage.Package> {
    if (!deploymentId) throw new Error("No deployment id");
    if (!appPackage) throw new Error("No package specified");

    const deployment = this._db.prepare("SELECT id FROM deployments WHERE id = ? AND appId = ?").get(deploymentId, appId);
    if (!deployment) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    appPackage = storage.clone(appPackage);

    return this.getPackageHistory(accountId, appId, deploymentId)
      .then((history: storage.Package[]) => {
        const label = "v" + (history.length + 1);
        appPackage.label = label;

        const releaseOwner = this.getAccount(accountId).catch(() => null);
        return releaseOwner.then((account: storage.Account | null) => {
          appPackage.releasedBy = account ? account.email : undefined;

          const lastPackage = history.length ? history[history.length - 1] : null;
          if (lastPackage) {
            lastPackage.rollout = null;
          }

          appPackage.uploadTime = appPackage.uploadTime || new Date().getTime();

          const id = shortid.generate();
          const packageJson = JSON.stringify(appPackage);

          this._db
            .prepare(
              "INSERT INTO packages (id, deploymentId, label, appVersion, packageHash, releasedBy, releaseMethod, rollout, size, isDisabled, isMandatory, uploadTime, diffPackageMap, packageJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .run(
              id,
              deploymentId,
              appPackage.label,
              appPackage.appVersion,
              appPackage.packageHash,
              appPackage.releasedBy,
              appPackage.releaseMethod,
              appPackage.rollout,
              appPackage.size,
              appPackage.isDisabled ? 1 : 0,
              appPackage.isMandatory ? 1 : 0,
              appPackage.uploadTime,
              appPackage.diffPackageMap ? JSON.stringify(appPackage.diffPackageMap) : null,
              packageJson
            );

          this._db.prepare("UPDATE deployments SET packageId = ? WHERE id = ?").run(id, deploymentId);

          const maxHistory = 50;
          const toDelete = this._db
            .prepare("SELECT id FROM packages WHERE deploymentId = ? ORDER BY uploadTime DESC LIMIT -1 OFFSET ?")
            .all(deploymentId, maxHistory);
          if (toDelete && toDelete.length) {
            const deleteStmt = this._db.prepare("DELETE FROM packages WHERE id = ?");
            for (const row of toDelete) {
              deleteStmt.run(row.id);
            }
          }

          return q(appPackage);
        });
      })
      .catch((error: any) => q.reject(storage.storageError(storage.ErrorCode.Other, error.message)));
  }

  public clearPackageHistory(accountId: string, appId: string, deploymentId: string): Promise<void> {
    const deployment = this._db.prepare("SELECT id FROM deployments WHERE id = ? AND appId = ?").get(deploymentId, appId);
    if (!deployment) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    this._db.prepare("DELETE FROM packages WHERE deploymentId = ?").run(deploymentId);
    this._db.prepare("UPDATE deployments SET packageId = NULL WHERE id = ?").run(deploymentId);

    return q(<void>null);
  }

  public getPackageHistory(accountId: string, appId: string, deploymentId: string): Promise<storage.Package[]> {
    const deployment = this._db.prepare("SELECT id FROM deployments WHERE id = ? AND appId = ?").get(deploymentId, appId);
    if (!deployment) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    const rows = this._db
      .prepare("SELECT packageJson FROM packages WHERE deploymentId = ? ORDER BY uploadTime")
      .all(deploymentId);

    const history = rows.map((row: any) => <storage.Package>JSON.parse(row.packageJson));
    return q(storage.clone(history));
  }

  public getPackageHistoryFromDeploymentKey(deploymentKey: string): Promise<storage.Package[]> {
    const deployment = this._db.prepare("SELECT id FROM deployments WHERE key = ?").get(deploymentKey);
    if (!deployment) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    const rows = this._db
      .prepare("SELECT packageJson FROM packages WHERE deploymentId = ? ORDER BY uploadTime")
      .all(deployment.id);
    const history = rows.map((row: any) => <storage.Package>JSON.parse(row.packageJson));
    return q(storage.clone(history));
  }

  public updatePackageHistory(accountId: string, appId: string, deploymentId: string, history: storage.Package[]): Promise<void> {
    if (!history || !history.length) {
      return q.reject(storage.storageError(storage.ErrorCode.Invalid, "Cannot clear package history from an update operation"));
    }

    const deployment = this._db.prepare("SELECT * FROM deployments WHERE id = ? AND appId = ?").get(deploymentId, appId);
    if (!deployment) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    const tx = this._db.transaction(() => {
      this._db.prepare("DELETE FROM packages WHERE deploymentId = ?").run(deploymentId);
      const insert = this._db.prepare(
        "INSERT INTO packages (id, deploymentId, label, appVersion, packageHash, releasedBy, releaseMethod, rollout, size, isDisabled, isMandatory, uploadTime, diffPackageMap, packageJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      let lastId: string = null;
      history.forEach((pkg: storage.Package) => {
        const id = shortid.generate();
        lastId = id;

        insert.run(
          id,
          deploymentId,
          pkg.label,
          pkg.appVersion,
          pkg.packageHash,
          pkg.releasedBy,
          pkg.releaseMethod,
          pkg.rollout,
          pkg.size,
          pkg.isDisabled ? 1 : 0,
          pkg.isMandatory ? 1 : 0,
          pkg.uploadTime,
          pkg.diffPackageMap ? JSON.stringify(pkg.diffPackageMap) : null,
          JSON.stringify(pkg)
        );
      });
      this._db.prepare("UPDATE deployments SET packageId = ? WHERE id = ?").run(lastId, deploymentId);
    });
    tx();

    return q(<void>null);
  }

  public addBlob(blobId: string, addstream: stream.Readable, streamLength: number): Promise<string> {
    if (!blobId) {
      blobId = shortid.generate();
    }

    const blobFile = path.join(this._blobDir, blobId);
    const writeStream = fs.createWriteStream(blobFile);

    const deferred = q.defer<string>();
    addstream.pipe(writeStream);

    addstream.on("error", (err: Error) => {
      deferred.reject(storage.storageError(storage.ErrorCode.Other, err.message));
    });

    writeStream.on("finish", () => {
      const stats = fs.statSync(blobFile);
      this._db.prepare("INSERT OR REPLACE INTO blobs (id, path, size) VALUES (?, ?, ?)").run(blobId, blobFile, stats.size);
      deferred.resolve(blobId);
    });

    writeStream.on("error", (err: Error) => {
      deferred.reject(storage.storageError(storage.ErrorCode.Other, err.message));
    });

    return deferred.promise;
  }

  public getBlobUrl(blobId: string): Promise<string> {
    const row = this._db.prepare("SELECT id FROM blobs WHERE id = ?").get(blobId);
    if (!row) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "Blob not found"));
    }

    const port = process.env.API_PORT || process.env.PORT || 3000;
    const host = process.env.API_HOST || "localhost";
    const baseUrl = process.env.SQLITE_BLOB_URL_BASE || `http://${host}:${port}`;

    return q(`${baseUrl}/blobs/${encodeURIComponent(blobId)}`);
  }

  public removeBlob(blobId: string): Promise<void> {
    const row = this._db.prepare("SELECT path FROM blobs WHERE id = ?").get(blobId);
    if (!row) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound, "Blob not found"));
    }

    try {
      fs.unlinkSync(row.path);
    } catch (e) {}

    this._db.prepare("DELETE FROM blobs WHERE id = ?").run(blobId);
    return q(<void>null);
  }

  public addAccessKey(accountId: string, accessKey: storage.AccessKey): Promise<string> {
    accessKey = storage.clone(accessKey);
    const account = this._db.prepare("SELECT id FROM accounts WHERE id = ?").get(accountId);
    if (!account) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    accessKey.id = shortid.generate();

    this._db
      .prepare(
        "INSERT INTO accessKeys (id, accountId, name, friendlyName, createdBy, createdTime, expires, isSession) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        accessKey.id,
        accountId,
        accessKey.name,
        accessKey.friendlyName,
        accessKey.createdBy,
        accessKey.createdTime,
        accessKey.expires,
        accessKey.isSession ? 1 : 0
      );

    return q(accessKey.id);
  }

  public getAccessKey(accountId: string, accessKeyId: string): Promise<storage.AccessKey> {
    const row = this._db.prepare("SELECT * FROM accessKeys WHERE id = ? AND accountId = ?").get(accessKeyId, accountId);
    if (!row) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    const accessKey: storage.AccessKey = {
      id: row.id,
      name: row.name,
      friendlyName: row.friendlyName,
      createdBy: row.createdBy,
      createdTime: row.createdTime,
      expires: row.expires,
      isSession: !!row.isSession,
    };

    return q(storage.clone(accessKey));
  }

  public getAccessKeys(accountId: string): Promise<storage.AccessKey[]> {
    const rows = this._db.prepare("SELECT * FROM accessKeys WHERE accountId = ?").all(accountId);
    const keys: storage.AccessKey[] = rows.map((row: any) => ({
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      friendlyName: row.friendlyName,
      createdBy: row.createdBy,
      createdTime: row.createdTime,
      expires: row.expires,
      isSession: !!row.isSession,
    }));

    return q(storage.clone(keys));
  }

  public removeAccessKey(accountId: string, accessKeyId: string): Promise<void> {
    const row = this._db.prepare("SELECT accountId FROM accessKeys WHERE id = ?").get(accessKeyId);
    if (row && row.accountId === accountId) {
      this._db.prepare("DELETE FROM accessKeys WHERE id = ?").run(accessKeyId);
      return q(<void>null);
    }

    return q.reject(storage.storageError(storage.ErrorCode.NotFound));
  }

  public updateAccessKey(accountId: string, accessKey: storage.AccessKey): Promise<void> {
    accessKey = storage.clone(accessKey);
    if (!accessKey || !accessKey.id) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    const existing = this._db.prepare("SELECT accountId FROM accessKeys WHERE id = ?").get(accessKey.id);
    if (!existing || existing.accountId !== accountId) {
      return q.reject(storage.storageError(storage.ErrorCode.NotFound));
    }

    this._db
      .prepare(
        "UPDATE accessKeys SET name = ?, friendlyName = ?, expires = ?, isSession = ? WHERE id = ?"
      )
      .run(accessKey.name, accessKey.friendlyName, accessKey.expires, accessKey.isSession ? 1 : 0, accessKey.id);

    return q(<void>null);
  }

  public dropAll(): Promise<void> {
    this._db.close();
    try {
      fs.unlinkSync(this._db.name);
    } catch (e) {}

    if (fs.existsSync(this._blobDir)) {
      fs.readdirSync(this._blobDir).forEach((file: string) => {
        try {
          fs.unlinkSync(path.join(this._blobDir, file));
        } catch (e) {}
      });
    }

    return q(<void>null);
  }

  private createSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        createdTime INTEGER NOT NULL,
        azureAdId TEXT,
        gitHubId TEXT,
        microsoftId TEXT
      );

      CREATE TABLE IF NOT EXISTS apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdTime INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_collaborators (
        appId TEXT NOT NULL,
        accountId TEXT NOT NULL,
        permission TEXT NOT NULL,
        FOREIGN KEY (appId) REFERENCES apps (id) ON DELETE CASCADE,
        FOREIGN KEY (accountId) REFERENCES accounts (id) ON DELETE CASCADE,
        UNIQUE(appId, accountId)
      );

      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        appId TEXT NOT NULL,
        name TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        createdTime INTEGER NOT NULL,
        packageId TEXT,
        FOREIGN KEY (appId) REFERENCES apps (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS packages (
        id TEXT PRIMARY KEY,
        deploymentId TEXT NOT NULL,
        label TEXT,
        appVersion TEXT,
        packageHash TEXT,
        releasedBy TEXT,
        releaseMethod TEXT,
        rollout REAL,
        size INTEGER,
        isDisabled INTEGER,
        isMandatory INTEGER,
        uploadTime INTEGER,
        diffPackageMap TEXT,
        packageJson TEXT,
        FOREIGN KEY (deploymentId) REFERENCES deployments (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS accessKeys (
        id TEXT PRIMARY KEY,
        accountId TEXT NOT NULL,
        name TEXT NOT NULL UNIQUE,
        friendlyName TEXT NOT NULL,
        createdBy TEXT,
        createdTime INTEGER NOT NULL,
        expires INTEGER NOT NULL,
        isSession INTEGER NOT NULL,
        FOREIGN KEY (accountId) REFERENCES accounts (id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS blobs (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        size INTEGER NOT NULL
      );
    `);
  }

  private getCollaboratorsMap(appId: string): storage.CollaboratorMap {
    const rows = this._db
      .prepare("SELECT c.accountId, c.permission, a.email FROM app_collaborators c JOIN accounts a ON c.accountId = a.id WHERE c.appId = ?")
      .all(appId);

    const collaborators: storage.CollaboratorMap = {};
    rows.forEach((row: any) => {
      collaborators[row.email] = {
        accountId: row.accountId,
        permission: row.permission,
      };
    });

    return collaborators;
  }

  private addIsCurrentAccountProperty(app: storage.App, accountId: string): void {
    if (app && app.collaborators) {
      Object.keys(app.collaborators).forEach((email: string) => {
        if (app.collaborators[email].accountId === accountId) {
          app.collaborators[email].isCurrentAccount = true;
        }
      });
    }
  }

  private removeIsCurrentAccountProperty(app: storage.App): void {
    if (app && app.collaborators) {
      Object.keys(app.collaborators).forEach((email: string) => {
        if (app.collaborators[email].isCurrentAccount) {
          delete app.collaborators[email].isCurrentAccount;
        }
      });
    }
  }

  private isOwner(collaborators: storage.CollaboratorMap, email: string): boolean {
    return collaborators && collaborators[email] && collaborators[email].permission === storage.Permissions.Owner;
  }

  private isCollaborator(collaborators: storage.CollaboratorMap, email: string): boolean {
    return collaborators && collaborators[email] && collaborators[email].permission === storage.Permissions.Collaborator;
  }

  private isCollaboratorByAccountId(collaborators: storage.CollaboratorMap, accountId: string): boolean {
    if (!collaborators) {
      return false;
    }
    return Object.keys(collaborators).some((email: string) => collaborators[email].accountId === accountId);
  }
}
