#include <stdio.h>
int set(int* p, int value) {
    *p = value;
    return *p;
}
int main(void) {
    int values[3] = {2, 4, 6};
    int* p = &values[0];
    p = p + 1;
    set(p, 9);
    printf("%d %d\n", values[1], *(p + 1));
    return 0;
}
