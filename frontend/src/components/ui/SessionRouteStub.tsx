import { ButtonLink, Card, CardBody } from "@/components/edplus";

type SessionRouteStubProps = {
  title: string;
  description: string;
};

export default function SessionRouteStub({ title, description }: SessionRouteStubProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
          {title}
        </h1>
        <p className="text-sm text-on-surface-variant mt-2">{description}</p>
      </header>

      <Card as="section" className="rounded-xl">
        <CardBody className="space-y-4">
          <p className="text-sm text-on-surface-variant">
            This screen is scaffolded so session navigation works end-to-end while Phase 2
            features are being built.
          </p>
          <ButtonLink href="/dashboard" variant="ghost">
            Back to Dashboard
          </ButtonLink>
        </CardBody>
      </Card>
    </div>
  );
}
