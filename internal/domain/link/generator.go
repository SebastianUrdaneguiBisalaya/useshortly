package link

type CodeGenerator interface {
	Generate() (string, error)
}
