int* escape(void) {
    int local = 7;
    return &local;
}
int main(void) {
    int* p = escape();
    return *p;
}
