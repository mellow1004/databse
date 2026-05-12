-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "primaryEmail" TEXT,
    "primaryPhone" TEXT,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "inferredGender" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "persons_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "rootDomain" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "parentCompanyId" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "headcountBand" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "companies_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "companies_parentCompanyId_fkey" FOREIGN KEY ("parentCompanyId") REFERENCES "companies" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "domain_aliases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "aliasDomain" TEXT NOT NULL,
    "aliasType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_aliases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "domain_aliases_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "seniority" TEXT,
    "gateStatus" TEXT NOT NULL DEFAULT 'gate_0',
    "campaignActive" BOOLEAN NOT NULL DEFAULT false,
    "quarantineReason" TEXT,
    "lifecycleStage" TEXT NOT NULL DEFAULT 'active',
    "freshnessLabel" TEXT,
    "lastVerifiedAt" DATETIME,
    "lastEnrichedAt" DATETIME,
    "derivedFieldVersion" TEXT,
    "writeSource" TEXT,
    "writePriority" INTEGER,
    "manualOverrideUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contacts_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contact_company_relationships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleType" TEXT NOT NULL,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_company_relationships_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contact_company_relationships_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contact_company_relationships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "persons_clientId_idx" ON "persons"("clientId");

-- CreateIndex
CREATE INDEX "persons_primaryEmail_idx" ON "persons"("primaryEmail");

-- CreateIndex
CREATE UNIQUE INDEX "persons_clientId_linkedinUrl_key" ON "persons"("clientId", "linkedinUrl");

-- CreateIndex
CREATE INDEX "companies_clientId_idx" ON "companies"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_clientId_rootDomain_key" ON "companies"("clientId", "rootDomain");

-- CreateIndex
CREATE INDEX "domain_aliases_companyId_idx" ON "domain_aliases"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "domain_aliases_clientId_aliasDomain_key" ON "domain_aliases"("clientId", "aliasDomain");

-- CreateIndex
CREATE INDEX "contacts_clientId_idx" ON "contacts"("clientId");

-- CreateIndex
CREATE INDEX "contacts_personId_idx" ON "contacts"("personId");

-- CreateIndex
CREATE INDEX "contacts_companyId_idx" ON "contacts"("companyId");

-- CreateIndex
CREATE INDEX "contacts_gateStatus_idx" ON "contacts"("gateStatus");

-- CreateIndex
CREATE INDEX "contacts_campaignActive_idx" ON "contacts"("campaignActive");

-- CreateIndex
CREATE INDEX "contact_company_relationships_contactId_idx" ON "contact_company_relationships"("contactId");

-- CreateIndex
CREATE INDEX "contact_company_relationships_companyId_idx" ON "contact_company_relationships"("companyId");

-- CreateIndex
CREATE INDEX "contact_company_relationships_clientId_roleType_idx" ON "contact_company_relationships"("clientId", "roleType");
